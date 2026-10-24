package dev.niessen.doctopus.core;

import static org.junit.jupiter.api.Assertions.*;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ManifestTest {
  @TempDir Path directory;

  private JsonObject vector() throws IOException {
    try (var stream = getClass().getResourceAsStream("/manifest-v2-vector.json")) {
      assertNotNull(stream);
      try (var reader = new InputStreamReader(stream, StandardCharsets.UTF_8)) {
        return JsonParser.parseReader(reader).getAsJsonObject();
      }
    }
  }
  private Path manifest(String text) throws IOException {
    Path file = directory.resolve("manifest.json");
    Files.writeString(file, text);
    return file;
  }

  @Test void verifiesTheSharedNodeVectorIncludingUnicodeAndNumericFileNames() throws Exception {
    JsonObject fixture = vector();
    String expected = fixture.get("artifactDigest").getAsString();
    assertEquals("42b177c8c4cdf584243ee49a25d21a40c10337d1b115ff0e5c2d688c0efd5edc", expected);
    assertEquals(expected, Manifest.sha256(fixture.get("canonical").getAsString().getBytes(StandardCharsets.UTF_8)));
    Manifest parsed = Manifest.read(manifest(fixture.get("manifestJson").getAsString()));
    assertEquals(expected, parsed.artifactDigest);
    assertEquals(5, parsed.files.size());
    assertTrue(parsed.files.containsKey("10"));
  }

  @Test void rejectsChangedMetadataWithoutAValidIdentity() throws Exception {
    String input = vector().get("manifestJson").getAsString();
    IOException error = assertThrows(IOException.class, () -> Manifest.read(manifest(input.replace("0.1.0", "0.1.1"))));
    assertTrue(error.getMessage().contains("identity mismatch"));
  }

  @Test void rejectsMalformedMetadataBeforeUsingAnyPaths() throws Exception {
    JsonObject root = vector().getAsJsonObject("manifest").deepCopy();
    // Use ASCII-only diagnostics while reserializing negative test variants.
    root.add("diagnostics", JsonParser.parseString("[]"));
    for (String path : List.of("../outside", "/absolute", "a//b", "a\\b", ".env", "assets/.hidden/file")) {
      JsonObject copy = root.deepCopy();
      var files = new JsonObject(); files.addProperty(path, "a".repeat(64)); copy.add("files", files);
      IOException error = assertThrows(IOException.class, () -> Manifest.read(manifest(copy.toString())));
      assertTrue(error.getMessage().contains("metadata"));
    }
    for (String field : List.of("files", "routes", "plugins", "diagnostics")) {
      JsonObject copy = root.deepCopy(); copy.addProperty(field, "wrong type");
      assertTrue(assertThrows(IOException.class, () -> Manifest.read(manifest(copy.toString()))).getMessage().contains("metadata"));
    }
    root.addProperty("injected", true);
    assertTrue(assertThrows(IOException.class, () -> Manifest.read(manifest(root.toString()))).getMessage().contains("metadata"));
  }

  @Test void rejectsDuplicateKeysInvalidUtf8AndTrailingDocuments() throws Exception {
    String wire = vector().get("manifestJson").getAsString();
    assertThrows(IOException.class, () -> Manifest.read(manifest(wire.replace("\"schemaVersion\":2", "\"schemaVersion\":2,\"schemaVersion\":2"))));
    assertThrows(IOException.class, () -> Manifest.read(manifest(wire + " {}")));
    Path file = manifest(wire);
    Files.write(file, new byte[]{(byte) 0xff, (byte) 0xfe});
    assertThrows(IOException.class, () -> Manifest.read(file));
  }

  @Test void boundsManifestBytesAndDepthAndRejectsDirectories() throws Exception {
    Path file = manifest("{}");
    try (var output = new java.io.RandomAccessFile(file.toFile(), "rw")) { output.setLength(Manifest.MAX_BYTES + 1L); }
    assertTrue(assertThrows(IOException.class, () -> Manifest.read(file)).getMessage().contains("16 MiB"));
    assertThrows(IOException.class, () -> Manifest.read(directory));
    assertThrows(IOException.class, () -> Manifest.read(manifest("[".repeat(34) + "0" + "]".repeat(34))));
  }

  @Test void requiresRebuildingLegacyPublicationsInsteadOfClaimingPortableVerification() throws Exception {
    String wire = vector().get("manifestJson").getAsString().replace("\"schemaVersion\":2", "\"schemaVersion\":1");
    assertTrue(assertThrows(IOException.class, () -> Manifest.read(manifest(wire))).getMessage().contains("Rebuild"));
  }

  private String publication(String site) throws IOException {
    String index = "<!doctype html><h1>Verified publication</h1>";
    Files.writeString(directory.resolve("index.html"), index);
    Files.writeString(directory.resolve("site.json"), site);
    String identity = "{\"compilerVersion\":\"0.1.0\",\"diagnostics\":[],\"files\":{\"index.html\":\""
        + Manifest.sha256(index.getBytes(StandardCharsets.UTF_8)) + "\",\"site.json\":\""
        + Manifest.sha256(site.getBytes(StandardCharsets.UTF_8)) + "\"},\"inputDigest\":\"" + "0".repeat(64)
        + "\",\"plugins\":[],\"routes\":[\"/\"],\"schemaVersion\":2}";
    String digest = Manifest.sha256(identity.getBytes(StandardCharsets.UTF_8));
    JsonObject metadata = JsonParser.parseString(identity).getAsJsonObject();
    metadata.addProperty("artifactDigest", digest);
    manifest(metadata.toString());
    return digest;
  }

  @Test void pinsAnExpectedDigestChecksPayloadBytesAndUsesTheManifestAllowlist() throws Exception {
    String digest = publication("{\"config\":{\"basePath\":\"/docs\"}}");
    var valid = new Publication(directory, digest);
    assertEquals(digest, valid.artifactDigest()); assertEquals("/docs", valid.basePath());
    assertThrows(IOException.class, () -> new Publication(directory, "0".repeat(64)));
    assertThrows(IOException.class, () -> valid.resolve("not-listed.txt"));
    Files.writeString(directory.resolve("index.html"), "corrupted");
    assertTrue(assertThrows(IOException.class, () -> new Publication(directory)).getMessage().contains("checksum"));
  }

  @Test void readsConfigurationWithoutMaterializingTheAggregateGraph() throws Exception {
    String site = "{\"config\":{\"basePath\":\"/docs\"},\"guides\":[{\"html\":\"" + "a".repeat(2 * 1024 * 1024) + "\"}]}";
    publication(site);
    assertEquals("/docs", new Publication(directory).basePath());
    publication("{\"config\":{\"basePath\":\"/docs\",\"basePath\":\"/other\"}}");
    assertThrows(IOException.class, () -> new Publication(directory));
    publication("{\"config\":{\"basePath\":42}}");
    assertThrows(IOException.class, () -> new Publication(directory));
  }
}
