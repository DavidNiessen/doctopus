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
  private final Publication publication;
  private final DoctopusProperties properties;
  DoctopusMvcConfiguration(Publication publication, DoctopusProperties properties) { this.publication = publication; this.properties = properties; }
  @Override public void addViewControllers(org.springframework.web.servlet.config.annotation.ViewControllerRegistry registry) {
    String mount = properties.mountPrefix();
    registry.addRedirectViewController(mount + "/", publication.basePath() + "/index.html").setContextRelative(false);
    if (!mount.isEmpty()) registry.addRedirectViewController(mount, publication.basePath() + "/index.html").setContextRelative(false);
  }
  @Override public void addResourceHandlers(ResourceHandlerRegistry registry) {
    registry.addResourceHandler(properties.mountPrefix() + "/**")
      .addResourceLocations(publication.root().toUri().toString()).setCachePeriod(0)
      .resourceChain(false).addResolver(new PathResourceResolver() {
        @Override protected Resource getResource(String path, Resource location) throws IOException {
          String file = path.isEmpty() ? "index.html" : path.endsWith("/") ? path + "index.html" : path;
          if (!publication.contains(file) && !file.substring(file.lastIndexOf('/') + 1).contains(".")) file += "/index.html";
          if (!publication.contains(file)) return null;
          publication.resolve(file);
          return super.getResource(file, location);
        }
      });
  }
}
