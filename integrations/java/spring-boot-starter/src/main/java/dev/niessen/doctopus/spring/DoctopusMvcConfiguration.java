package dev.niessen.doctopus.spring;
import dev.niessen.doctopus.core.Publication;
import java.io.IOException;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.resource.PathResourceResolver;

@Configuration(proxyBeanMethods = false)
@ConditionalOnClass(WebMvcConfigurer.class)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
class DoctopusMvcConfiguration implements WebMvcConfigurer {
  @org.springframework.context.annotation.Bean
  static DoctopusHostContext doctopusHostContext(org.springframework.core.env.Environment environment) {
    return new DoctopusHostContext(environment.getProperty("server.servlet.context-path", ""));
  }
  private final DoctopusSite site;
  private final DoctopusProperties properties;
  DoctopusMvcConfiguration(DoctopusSite site, DoctopusProperties properties) { this.site = site; this.properties = properties; }
  @Override public void addViewControllers(org.springframework.web.servlet.config.annotation.ViewControllerRegistry registry) {
    String mount = properties.mountPrefix();
    registry.addRedirectViewController(mount + "/", site.basePath() + "/index.html").setContextRelative(false);
    if (!mount.isEmpty()) registry.addRedirectViewController(mount, site.basePath() + "/index.html").setContextRelative(false);
  }
  @Override public void addResourceHandlers(ResourceHandlerRegistry registry) {
    registry.addResourceHandler(properties.mountPrefix() + "/**")
      .addResourceLocations(site.direct() == null ? site.publication().root().toUri().toString() : "classpath:/META-INF/doctopus/reader/").setCachePeriod(0)
      .resourceChain(false).addResolver(new PathResourceResolver() {
        @Override protected Resource getResource(String path, Resource location) throws IOException {
          if (site.direct() != null) {
            byte[] bytes = site.direct().read(path);
            return bytes == null ? null : new DirectResource(bytes, site.direct().isDocument(path) ? "index.html" : path);
          }
          String file = path.isEmpty() ? "index.html" : path.endsWith("/") ? path + "index.html" : path;
          if (!site.publication().contains(file) && !file.substring(file.lastIndexOf('/') + 1).contains(".")) file += "/index.html";
          if (!site.publication().contains(file)) return null;
          site.publication().resolve(file);
          return super.getResource(file, location);
        }
      });
  }
  private static final class DirectResource extends org.springframework.core.io.ByteArrayResource implements org.springframework.web.servlet.resource.HttpResource {
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
