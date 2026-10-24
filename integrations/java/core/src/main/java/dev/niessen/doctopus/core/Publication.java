package dev.niessen.doctopus.core;

import com.google.gson.Strictness;
import com.google.gson.stream.JsonReader;
import com.google.gson.stream.JsonToken;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Set;

/**
 * A static publication whose portable manifest and file digests are verified at construction.
 * No JavaScript runtime is needed to serve it. Keep the directory immutable while serving it;
 * verification does not lock files or rehash their contents on every request.
 */
public final class Publication {
  private final Path root;
  private final String basePath;
  private final String artifactDigest;
  private final Set<String> files;

  /**
   * Verify a publication without an external identity pin.
   * @param directory the prebuilt publication directory
   * @throws IOException if metadata, paths or file checksums fail verification
   */
  public Publication(Path directory) throws IOException {
    this(directory, null);
  }

  /**
   * Verify a publication and optionally pin its identity to a trusted build inventory.
   * @param directory the prebuilt publication directory
   * @param expectedArtifactDigest a lowercase SHA-256 identity, or null to omit the pin
   * @throws IOException if identity, metadata, paths or file checksums fail verification
   */
  public Publication(Path directory, String expectedArtifactDigest) throws IOException {
    root = directory.toRealPath();
    Manifest manifest = Manifest.read(root.resolve("manifest.json"));
    artifactDigest = manifest.artifactDigest;
    if (expectedArtifactDigest != null && (!expectedArtifactDigest.matches("[a-f0-9]{64}")
        || !MessageDigest.isEqual(expectedArtifactDigest.getBytes(StandardCharsets.US_ASCII),
            artifactDigest.getBytes(StandardCharsets.US_ASCII))))
      throw new IOException("Publication does not match the pinned artifact digest");
    files = manifest.files.keySet();
    for (String file : files) {
      Path path = resolve(file);
      try (var stream = Files.newInputStream(path)) {
        var digest = MessageDigest.getInstance("SHA-256");
        var bytes = new byte[8192];
        int length;
        while ((length = stream.read(bytes)) != -1) digest.update(bytes, 0, length);
        if (!HexFormat.of().formatHex(digest.digest()).equals(
            manifest.files.get(file))) {
          throw new IOException("Publication checksum mismatch: " + file);
        }
      } catch (NoSuchAlgorithmException error) {
        throw new IOException("SHA-256 is unavailable", error);
      }
    }
    basePath = readBasePath(resolve("site.json"));
  }

  private static String readBasePath(Path site) throws IOException {
    String base = null; boolean config = false;
    // Skip the aggregate graph instead of materializing every guide and schema in Java memory.
    try (var stream = Files.newInputStream(site);
         var input = new InputStreamReader(stream, StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT));
         var reader = new JsonReader(input)) {
      reader.setStrictness(Strictness.STRICT);
      reader.beginObject();
      while (reader.hasNext()) {
        if (!reader.nextName().equals("config")) { reader.skipValue(); continue; }
        if (config) throw new IOException("Duplicate publication configuration");
        config = true; reader.beginObject();
        while (reader.hasNext()) {
          if (!reader.nextName().equals("basePath")) { reader.skipValue(); continue; }
          if (base != null || reader.peek() != JsonToken.STRING) throw new IOException("Invalid publication base path");
          base = reader.nextString();
        }
        reader.endObject();
      }
      reader.endObject();
      if (reader.peek() != JsonToken.END_DOCUMENT || base == null || !(base.isEmpty()
          || base.matches("/[a-zA-Z0-9][a-zA-Z0-9/_-]*") && !base.endsWith("/")))
        throw new IOException("Invalid publication base path");
      return base;
    } catch (RuntimeException error) { throw new IOException("Invalid publication configuration"); }
  }

  /**
   * Resolve a manifest-listed file to a regular file inside the canonical publication root.
   * @param file a relative logical path from the manifest
   * @return the canonical file path
   * @throws IOException if the file is unlisted, missing or escapes the publication root
   */
  public Path resolve(String file) throws IOException {
    if (!files.contains(file)) throw new IOException("File is not in the publication manifest");
    Path target = root.resolve(file).toRealPath();
    if (!target.startsWith(root) || !Files.isRegularFile(target)) {
      throw new IOException("Publication path escapes its root");
    }
    return target;
  }

  /**
   * Check logical manifest membership without performing a filesystem lookup.
   * @param file a relative logical path
   * @return whether the path appears in the verified manifest
   */
  public boolean contains(String file) { return files.contains(file); }
  /** @return the compiled public base path, empty for root hosting */
  public String basePath() { return basePath; }
  /** @return the verified portable manifest identity as lowercase SHA-256 */
  public String artifactDigest() { return artifactDigest; }
  /** @return the canonical directory; serve only files accepted by {@link #resolve(String)} */
  public Path root() { return root; }
}
