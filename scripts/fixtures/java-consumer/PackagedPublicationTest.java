package dev.niessen.doctopus.consumer;

import static org.junit.jupiter.api.Assertions.*;
import dev.niessen.doctopus.core.Publication;
import dev.niessen.doctopus.spring.DoctopusAutoConfiguration;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import org.junit.jupiter.api.Test;

class PackagedPublicationTest {
  @Test void publicClassesComeFromTheExactInstalledJarsAndVerifyTheRealPublication() throws Exception {
    verifyOrigin(Publication.class, "consumer.core.sha256");
    verifyOrigin(DoctopusAutoConfiguration.class, "consumer.starter.sha256");
    var publication = new Publication(Path.of(System.getProperty("consumer.fixture")),
        System.getProperty("consumer.artifactDigest"));
    assertEquals("/gateway/docs", publication.basePath());
    assertTrue(publication.contains("index.html"));
    assertTrue(Files.readString(publication.resolve("index.html")).contains("/gateway/docs/assets/reader.js"));
    assertThrows(java.io.IOException.class, () -> publication.resolve("../private.txt"));
  }
  private void verifyOrigin(Class<?> type, String expectedProperty) throws Exception {
    var origin = Path.of(type.getProtectionDomain().getCodeSource().getLocation().toURI()).toRealPath();
    assertTrue(Files.isRegularFile(origin) && origin.getFileName().toString().endsWith(".jar"),
        "A consumer must use an installed JAR, never reactor classes");
    assertFalse(origin.startsWith(Path.of(System.getProperty("consumer.sourceRoot")).toRealPath()),
        "The installed artifact must be outside the source checkout");
    try (var input = Files.newInputStream(origin)) {
      var digest = MessageDigest.getInstance("SHA-256");
      var buffer = new byte[8192];
      for (int count; (count = input.read(buffer)) != -1;) digest.update(buffer, 0, count);
      assertEquals(System.getProperty(expectedProperty), HexFormat.of().formatHex(digest.digest()),
          "The consumer must load the exact inspected baseline candidate");
    }
  }
}
