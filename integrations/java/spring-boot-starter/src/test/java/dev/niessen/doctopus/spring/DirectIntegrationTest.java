package dev.niessen.doctopus.spring;
import static org.junit.jupiter.api.Assertions.*;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;

class DirectIntegrationTest {
  @Test void mvcServesBundledDirectDocumentationWithoutAProjectOrPublication() throws Exception {
    exercise(DoctopusIntegrationTest.MvcApplication.class,WebApplicationType.SERVLET);
  }
  @Test void webfluxServesBundledDirectDocumentationWithoutAProjectOrPublication() throws Exception {
    exercise(DoctopusIntegrationTest.ReactiveApplication.class,WebApplicationType.REACTIVE);
  }
  private void exercise(Class<?> application,WebApplicationType type) throws Exception {
    for(String context:new String[]{"","/gateway"}) {
      String prefix=context+"/docs";
      try(var app=new SpringApplicationBuilder(application).web(type).properties(
          "server.port=0", "doctopus.url="+context+"/openapi.yaml", "doctopus.title=Harbor API",
          "doctopus.theme=ocean", "doctopus.layout=classic", "doctopus.appearance=dark",
          "server.servlet.context-path="+context, "spring.webflux.base-path="+context,
          "spring.main.banner-mode=off", "logging.level.root=WARN").run()) {
        assertFalse(app.containsBean("doctopusPublication"));
        String base="http://127.0.0.1:"+app.getEnvironment().getProperty("local.server.port");
        var client=HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NORMAL).build();
        String auth="Basic "+Base64.getEncoder().encodeToString("reader:fixture-password".getBytes(StandardCharsets.UTF_8));
        for(String path:new String[]{"/","/assets/reader.js","/assets/reader.css","/api/api/v1/hello/"}) {
          assertEquals(401,client.send(HttpRequest.newBuilder(URI.create(base+prefix+path)).GET().build(),HttpResponse.BodyHandlers.ofString()).statusCode());
          var response=client.send(HttpRequest.newBuilder(URI.create(base+prefix+path)).header("Authorization",auth).GET().build(),HttpResponse.BodyHandlers.ofString());
          assertEquals(200,response.statusCode(),"Direct resource: "+path);
          assertTrue(response.headers().firstValue("content-security-policy").orElse("").contains("script-src 'self'"));
          if(path.equals("/") || path.startsWith("/api/")) {
            assertTrue(response.body().contains(prefix+"/assets/reader.css"));
            assertTrue(response.body().contains("Harbor API"));
            assertTrue(response.body().contains("application/json"));
          }
        }
        for(String path:new String[]{"/direct-assets.json","/private.json","/manifest.json"})
          assertEquals(404,client.send(HttpRequest.newBuilder(URI.create(base+prefix+path)).header("Authorization",auth).GET().build(),HttpResponse.BodyHandlers.ofString()).statusCode());
      }
    }
  }
}
