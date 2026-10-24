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

/** Mounts a verified publication using the available web stack and existing host security. */
@AutoConfiguration
@ConditionalOnProperty(prefix = "doctopus", name = "enabled", havingValue = "true", matchIfMissing = true)
@EnableConfigurationProperties(DoctopusProperties.class)
@Import({DoctopusMvcConfiguration.class, DoctopusReactiveConfiguration.class})
public class DoctopusAutoConfiguration {
  /** Create the auto-configuration discovered by Spring Boot. */
  public DoctopusAutoConfiguration() {}
  @Bean
  Publication doctopusPublication(DoctopusProperties properties, Environment environment,
      ObjectProvider<DoctopusHostContext> hostContext) throws IOException {
    if (properties.getDirectory() == null) {
      throw new IllegalArgumentException("Set doctopus.directory to a prebuilt publication directory, or disable doctopus.enabled");
    }
    String mount = properties.mountPrefix();
    var publication = new Publication(Path.of(properties.getDirectory()), properties.getArtifactDigest());
    String context = hostContext.getIfAvailable(() -> new DoctopusHostContext(
        environment.getProperty("server.servlet.context-path",
            environment.getProperty("spring.webflux.base-path", "")))).prefix();
    String expected = properties.getPublicBasePath() == null ? context + mount : properties.getPublicBasePath();
    if (!publication.basePath().equals(expected)) {
      throw new IllegalArgumentException("Publication basePath must match the public context and docs path: " + expected);
    }
    return publication;
  }
}
