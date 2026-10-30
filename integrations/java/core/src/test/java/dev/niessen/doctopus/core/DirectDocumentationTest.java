package dev.niessen.doctopus.core;
import static org.junit.jupiter.api.Assertions.*;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.junit.jupiter.api.Test;
class DirectDocumentationTest {
  @Test void bundledReaderNeedsNoPublicationAndEscapesPublicConfiguration() throws Exception {
    String title = "Company </script><script>alert(1)</script> __DOCTOPUS_CONFIG__";
    var site = new DirectDocumentation(Map.of("url", "/openapi.yaml", "title", title), "/gateway/docs");
    String html = new String(site.read("index.html"), StandardCharsets.UTF_8);
    assertTrue(html.contains("href=\"/gateway/docs/assets/reader.css\""));
    assertFalse(html.contains("<script>alert(1)</script>"));
    assertTrue(html.contains("__DOCTOPUS_CONFIG__"));
    assertNotNull(site.read("assets/reader.js"));
    assertTrue(site.isDocument("api/api/v1/hello/"));
    assertNull(site.read("assets/private.txt"));
    assertNull(site.read("direct-assets.json"));
    assertNull(site.read("manifest.json"));
    assertNull(site.read("../private.json"));
  }
  @Test void replacementThemesApplyBeforeTheShellPaints() throws Exception {
    for (String theme : new String[]{"ember", "contrast"}) {
      var site = new DirectDocumentation(Map.of("theme", theme), "/docs");
      String html = new String(site.read("index.html"), StandardCharsets.UTF_8);
      assertTrue(html.contains("src=\"/docs/assets/theme.js\""));
      assertTrue(html.indexOf("assets/theme.js") < html.indexOf("<body>"));
      assertNotNull(site.read("assets/theme.js"));
    }
  }
  @Test void validatesPublicUrlsAndPreparedAppearance() {
    for (String url : new String[]{"javascript:alert(1)", "data:text/html,hi", "https://user:secret@example.com/spec", "/openapi.json#secret"})
      assertThrows(IllegalArgumentException.class, () -> new DirectDocumentation(Map.of("url",url), "/docs"));
    assertThrows(IllegalArgumentException.class, () -> new DirectDocumentation(Map.of("theme","unknown"), "/docs"));
    assertThrows(IllegalArgumentException.class, () -> new DirectDocumentation(Map.of(), "/docs/../private"));
  }
}
