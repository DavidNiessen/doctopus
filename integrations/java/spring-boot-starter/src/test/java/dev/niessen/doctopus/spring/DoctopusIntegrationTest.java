package dev.niessen.doctopus.spring;

import static org.junit.jupiter.api.Assertions.*;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.WebApplicationType;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.web.server.ServerHttpSecurity;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.core.userdetails.MapReactiveUserDetailsService;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.server.SecurityWebFilterChain;

class DoctopusIntegrationTest {
  @SpringBootConfiguration @EnableAutoConfiguration @Import(MvcSecurity.class)
  static class MvcApplication {}
  @SpringBootConfiguration @EnableAutoConfiguration @Import(ReactiveSecurity.class)
  static class ReactiveApplication {}
  static class MvcSecurity {
    @Bean InMemoryUserDetailsManager users() { return new InMemoryUserDetailsManager(User.withUsername("reader").password("{noop}fixture-password").roles("DOCS").build()); }
    @Bean SecurityFilterChain security(HttpSecurity http) throws Exception { return http.authorizeHttpRequests(authorize -> authorize.anyRequest().authenticated()).httpBasic(Customizer.withDefaults()).build(); }
  }
  static class ReactiveSecurity {
    @Bean MapReactiveUserDetailsService users() { return new MapReactiveUserDetailsService(User.withUsername("reader").password("{noop}fixture-password").roles("DOCS").build()); }
    @Bean SecurityWebFilterChain security(ServerHttpSecurity http) { return http.authorizeExchange(authorize -> authorize.anyExchange().authenticated()).httpBasic(Customizer.withDefaults()).build(); }
  }
  @Test void servletMountServesARealVerifiedPublicationBehindHostSecurity() throws Exception { exercise(MvcApplication.class, WebApplicationType.SERVLET); }
  @Test void reactiveMountServesARealVerifiedPublicationBehindHostSecurity() throws Exception { exercise(ReactiveApplication.class, WebApplicationType.REACTIVE); }
  private void exercise(Class<?> application, WebApplicationType type) throws Exception {
    String directory = System.getProperty("doctopus.fixture");
    assertNotNull(directory, "Prepare the real reader fixture before running Java integration tests");
    String digest = new dev.niessen.doctopus.core.Publication(java.nio.file.Path.of(directory)).artifactDigest();
    try (var context = new SpringApplicationBuilder(application).web(type).properties(
        "server.port=0", "doctopus.directory=" + directory, "doctopus.path=/docs",
        "doctopus.artifact-digest=" + digest,
        "spring.main.banner-mode=off", "logging.level.root=WARN").run()) {
      String base = "http://127.0.0.1:" + context.getEnvironment().getProperty("local.server.port");
      var client = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NORMAL).build();
      String credential = "Basic " + Base64.getEncoder().encodeToString("reader:fixture-password".getBytes(java.nio.charset.StandardCharsets.UTF_8));
      for (String path : new String[]{"/docs/", "/docs/search.json", "/docs/assets/reader.js", "/docs/guides/quickstart/", "/docs/oauth/callback/", "/docs/assets/oauth-callback.js"}) {
        assertEquals(401, client.send(HttpRequest.newBuilder(URI.create(base + path)).GET().build(), HttpResponse.BodyHandlers.ofString()).statusCode());
        var response = client.send(HttpRequest.newBuilder(URI.create(base + path)).header("Authorization", credential).GET().build(), HttpResponse.BodyHandlers.ofString());
        assertEquals(200, response.statusCode(), "Failed to serve " + path);
      }
      var page = client.send(HttpRequest.newBuilder(URI.create(base + "/docs/guides/quickstart/")).header("Authorization", credential).GET().build(), HttpResponse.BodyHandlers.ofString());
      assertTrue(page.body().contains("/docs/assets/reader.js"));
      assertEquals(404, client.send(HttpRequest.newBuilder(URI.create(base + "/docs/missing.json")).header("Authorization", credential).GET().build(), HttpResponse.BodyHandlers.ofString()).statusCode());
    }
  }
}
