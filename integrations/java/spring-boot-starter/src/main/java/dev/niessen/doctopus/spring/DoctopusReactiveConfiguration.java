package dev.niessen.doctopus.spring;
import dev.niessen.doctopus.core.Publication;
import java.io.IOException;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;
import org.springframework.web.reactive.config.WebFluxConfigurer;
import org.springframework.web.reactive.config.ResourceHandlerRegistry;
import org.springframework.web.reactive.resource.PathResourceResolver;
import reactor.core.publisher.Mono;

@Configuration(proxyBeanMethods = false)
@ConditionalOnClass(WebFluxConfigurer.class)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.REACTIVE)
class DoctopusReactiveConfiguration implements WebFluxConfigurer {
  @org.springframework.context.annotation.Bean
  static DoctopusHostContext doctopusHostContext(org.springframework.core.env.Environment environment) {
    return new DoctopusHostContext(environment.getProperty("spring.webflux.base-path", ""));
  }
  private final DoctopusSite site;
  private final DoctopusProperties properties;
  DoctopusReactiveConfiguration(DoctopusSite site, DoctopusProperties properties) { this.site = site; this.properties = properties; }
  @org.springframework.context.annotation.Bean
  org.springframework.web.reactive.function.server.RouterFunction<org.springframework.web.reactive.function.server.ServerResponse> doctopusIndex() {
    String mount = properties.mountPrefix();
    return org.springframework.web.reactive.function.server.RouterFunctions.route(
      org.springframework.web.reactive.function.server.RequestPredicates.GET(mount).or(org.springframework.web.reactive.function.server.RequestPredicates.GET(mount + "/")),
      request -> org.springframework.web.reactive.function.server.ServerResponse.temporaryRedirect(java.net.URI.create(site.basePath() + "/index.html")).build());
  }
  @Override public void addResourceHandlers(ResourceHandlerRegistry registry) {
    registry.addResourceHandler(properties.mountPrefix() + "/**")
      .addResourceLocations(site.direct() == null ? site.publication().root().toUri().toString() : "classpath:/META-INF/doctopus/reader/").resourceChain(false)
      .addResolver(new PathResourceResolver() {
        @Override protected Mono<Resource> getResource(String path, Resource location) {
          if (site.direct() != null) {
            byte[] bytes = site.direct().read(path);
            return bytes == null ? Mono.empty() : Mono.just(new DirectResource(bytes, site.direct().isDocument(path) ? "index.html" : path));
          }
          String file = path.isEmpty() ? "index.html" : path.endsWith("/") ? path + "index.html" : path;
          if (!site.publication().contains(file) && !file.substring(file.lastIndexOf('/') + 1).contains(".")) file += "/index.html";
          if (!site.publication().contains(file)) return Mono.empty();
          try { site.publication().resolve(file); } catch (IOException error) { return Mono.error(error); }
          return super.getResource(file, location);
        }
      });
  }
  private static final class DirectResource extends org.springframework.core.io.ByteArrayResource implements org.springframework.web.reactive.resource.HttpResource {
    private final String filename;
    DirectResource(byte[] bytes, String filename) { super(bytes); this.filename = filename; }
    @Override public String getFilename() { return filename; }
    @Override public long lastModified() { return 0; }
    @Override public org.springframework.http.HttpHeaders getResponseHeaders() {
      var headers = new org.springframework.http.HttpHeaders();
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Referrer-Policy", "no-referrer");
      headers.set("Cache-Control", filename.equals("index.html") ? "no-store" : "no-cache");
      headers.set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self'; connect-src http: https:; base-uri 'none'; frame-ancestors 'none'");
      return headers;
    }
  }

}
