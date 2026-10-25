package dev.niessen.doctopus.spring;
import dev.niessen.doctopus.core.Publication;
import java.io.IOException;
import java.nio.file.Path;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.core.env.Environment;
import org.springframework.beans.factory.ObjectProvider;

/** Mounts the bundled API reference or a verified publication using the active web stack and host security. */
@AutoConfiguration
@ConditionalOnProperty(prefix = "doctopus", name = "enabled", havingValue = "true", matchIfMissing = true)
@EnableConfigurationProperties(DoctopusProperties.class)
@Import({DoctopusMvcConfiguration.class, DoctopusReactiveConfiguration.class})
public class DoctopusAutoConfiguration {
  /** Create the auto-configuration discovered by Spring Boot. */
  public DoctopusAutoConfiguration() {}
  @Bean
  DoctopusSite doctopusSite(DoctopusProperties properties, Environment environment,
      ObjectProvider<DoctopusHostContext> hostContext) throws IOException {
    String mount = properties.mountPrefix();
    String context = hostContext.getIfAvailable(() -> new DoctopusHostContext(
        environment.getProperty("server.servlet.context-path",
            environment.getProperty("spring.webflux.base-path", "")))).prefix();
    String expected = properties.getPublicBasePath() == null ? context + mount : properties.getPublicBasePath();
    if (properties.getDirectory() == null) {
      if (properties.getArtifactDigest() != null)
        throw new IllegalArgumentException("An artifact digest requires a prebuilt directory");
      var options = properties.directOptions();
      options.putIfAbsent("url", context + "/v3/api-docs");
      var direct = new dev.niessen.doctopus.core.DirectDocumentation(options, expected);
      return new DoctopusSite(null, direct, expected);
    }
    if (!properties.directOptions().isEmpty())
      throw new IllegalArgumentException("Choose a prebuilt directory or direct specification settings, not both");
    var publication = new Publication(Path.of(properties.getDirectory()), properties.getArtifactDigest());
    if (!publication.basePath().equals(expected))
      throw new IllegalArgumentException("Publication basePath must match the public context and docs path: " + expected);
    return new DoctopusSite(publication, null, expected);
  }
  @Bean
  @ConditionalOnProperty(prefix = "doctopus", name = "directory")
  Publication doctopusPublication(DoctopusSite site) { return site.publication(); }
}
