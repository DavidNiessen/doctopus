package dev.niessen.doctopus.consumer;

import static org.junit.jupiter.api.Assertions.*;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;

final class HostProbe {
  static void exercise(Class<?> application, WebApplicationType type, String absentClass) throws Exception {
    exercise(application, type, absentClass, "consumer.fixture", "consumer.artifactDigest", "/gateway", "/docs", "/gateway/docs");
  }
  static void exerciseRoot(Class<?> application, WebApplicationType type, String absentClass, boolean context) throws Exception {
    exercise(application, type, absentClass,
        context ? "consumer.rootFixture" : "consumer.standaloneFixture",
        context ? "consumer.rootArtifactDigest" : "consumer.standaloneArtifactDigest",
        context ? "/gateway" : "", "/", context ? "/gateway" : "");
  }
  private static void exercise(Class<?> application, WebApplicationType type, String absentClass,
      String fixtureProperty, String digestProperty, String contextPath, String mount, String publicBase) throws Exception {
    assertThrows(ClassNotFoundException.class, () -> Class.forName(absentClass),
        "Optional dependencies must remain absent from this consumer's classpath");
    Path root = Path.of(System.getProperty(fixtureProperty));
    Path hidden = root.resolve("unlisted-consumer-file.txt");
    Files.writeString(hidden, "A real file outside the publication manifest");
    try (var context = new SpringApplicationBuilder(application).web(type).properties(
        "server.port=0", "server.servlet.context-path=" + (type == WebApplicationType.SERVLET ? contextPath : "/inactive-stack"),
        "spring.webflux.base-path=" + (type == WebApplicationType.REACTIVE ? contextPath : "/inactive-stack"),
        "doctopus.directory=" + root, "doctopus.path=" + mount,
        "doctopus.artifact-digest=" + System.getProperty(digestProperty),
        "spring.main.banner-mode=off", "logging.level.root=WARN").run()) {
      String base = "http://127.0.0.1:" + context.getEnvironment().getProperty("local.server.port");
      var client = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NORMAL).build();
      String credential = "Basic " + Base64.getEncoder().encodeToString(
          "reader:fixture-password".getBytes(StandardCharsets.UTF_8));
      for (String path : new String[]{"/", "/search.json", "/assets/reader.js", "/guides/quickstart/",
          "/oauth/callback/", "/assets/oauth-callback.js"}) {
        URI uri = URI.create(base + publicBase + path);
        assertEquals(401, client.send(HttpRequest.newBuilder(uri).GET().build(),
            HttpResponse.BodyHandlers.ofString()).statusCode(), "Host security must cover " + path);
        var response = client.send(HttpRequest.newBuilder(uri).header("Authorization", credential).GET().build(),
            HttpResponse.BodyHandlers.ofString());
        assertEquals(200, response.statusCode(), "Failed to serve " + path + " at " + response.uri());
        if (path.equals("/")) assertEquals(publicBase + "/index.html", response.uri().getPath(),
            "The context prefix must appear exactly once in the landing-page redirect");
      }
      if (!publicBase.isEmpty()) {
        var response = client.send(HttpRequest.newBuilder(URI.create(base + publicBase))
            .header("Authorization", credential).GET().build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(200, response.statusCode(), "The mount without a trailing slash must work");
        assertEquals(publicBase + "/index.html", response.uri().getPath());
      }
      for (String path : new String[]{"/missing.json", "/unlisted-consumer-file.txt"}) {
        assertEquals(404, client.send(HttpRequest.newBuilder(URI.create(base + publicBase + path))
            .header("Authorization", credential).GET().build(), HttpResponse.BodyHandlers.ofString()).statusCode());
      }
      var host = client.send(HttpRequest.newBuilder(URI.create(base + contextPath + "/host-owned"))
          .header("Authorization", credential).GET().build(), HttpResponse.BodyHandlers.ofString());
      assertEquals(200, host.statusCode(), "Documentation must preserve application-owned routes");
      assertEquals("host-owned", host.body());
    } finally {
      Files.deleteIfExists(hidden);
    }
  }
}
