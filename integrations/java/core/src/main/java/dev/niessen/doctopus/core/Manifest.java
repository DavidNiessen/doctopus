package dev.niessen.doctopus.core;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import com.google.gson.Strictness;
import com.google.gson.stream.JsonReader;
import com.google.gson.stream.JsonToken;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.math.BigDecimal;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/** Manifest v2 uses UTF-16 key ordering and JSON string escaping shared with the Node compiler. */
final class Manifest {
  static final int MAX_BYTES = 16 * 1024 * 1024;
  final Map<String, String> files;
  final String artifactDigest;

  private Manifest(Map<String, String> files, String artifactDigest) {
    this.files = Map.copyOf(files);
    this.artifactDigest = artifactDigest;
  }

  static Manifest read(Path path) throws IOException {
    if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS) || Files.size(path) > MAX_BYTES)
      throw new IOException("Publication manifest must be a regular file of at most 16 MiB");
    try (InputStream stream = new LimitedInput(Files.newInputStream(path, LinkOption.NOFOLLOW_LINKS));
         var input = new InputStreamReader(stream, StandardCharsets.UTF_8.newDecoder()
             .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT));
         var reader = new JsonReader(input)) {
      reader.setStrictness(Strictness.STRICT);
      JsonElement parsed = readJson(reader, 0, new int[]{0});
      if (reader.peek() != JsonToken.END_DOCUMENT || !parsed.isJsonObject()) throw invalid();
      JsonObject root = parsed.getAsJsonObject();
      if (number(root.get("schemaVersion")) == 1)
        throw new IOException("Manifest v1 is not portable across runtimes. Rebuild this publication with the current CLI before upgrading the Java adapter.");
      require(number(root.get("schemaVersion")) == 2);
      keys(root, Set.of("schemaVersion", "compilerVersion", "inputDigest", "artifactDigest", "files", "routes", "diagnostics", "plugins"));
      require(text(root.get("compilerVersion"), 128) && hash(root.get("inputDigest")) && hash(root.get("artifactDigest")));
      JsonObject fileObject = object(root.get("files"));
      require(fileObject.size() <= 200_000);
      var files = new HashMap<String, String>();
      for (var entry : fileObject.entrySet()) {
        require(safePath(entry.getKey()) && hash(entry.getValue()));
        files.put(entry.getKey(), entry.getValue().getAsString());
      }
      JsonArray routes = array(root.get("routes"));
      require(routes.size() <= 100_000);
      var uniqueRoutes = new HashSet<String>();
      for (var route : routes) {
        require(text(route, 4098));
        String value = route.getAsString();
        require(value.equals("/") || value.startsWith("/") && safePath(value.substring(1).replaceFirst("/$", "")));
        require(uniqueRoutes.add(value));
      }
      JsonArray diagnostics = array(root.get("diagnostics"));
      require(diagnostics.size() <= 10_000);
      for (var diagnostic : diagnostics) {
        JsonObject item = object(diagnostic);
        keys(item, Set.of("code", "severity", "message", "source"));
        require(text(item.get("code"), 200) && text(item.get("severity"), 7)
            && Set.of("warning", "error").contains(item.get("severity").getAsString())
            && text(item.get("message"), 12_000));
        require(!item.has("source") || text(item.get("source"), 4096));
      }
      JsonArray plugins = array(root.get("plugins"));
      require(plugins.size() <= 32);
      for (var plugin : plugins) {
        JsonObject item = object(plugin);
        keys(item, Set.of("name", "version", "sourceDigest", "inputs"));
        require(text(item.get("name"), 214) && text(item.get("version"), 128));
        require(!item.has("sourceDigest") || hash(item.get("sourceDigest")));
        if (item.has("inputs")) {
          JsonArray inputs = array(item.get("inputs"));
          require(inputs.size() <= 129);
          for (var source : inputs) {
            JsonObject field = object(source);
            keys(field, Set.of("path", "digest"));
            require(text(field.get("path"), 4096) && hash(field.get("digest")));
          }
        }
      }
      String expected = root.get("artifactDigest").getAsString();
      root.remove("artifactDigest");
      root.addProperty("schemaVersion", 2);
      var canonical = new StringBuilder();
      canonical(root, canonical);
      String actual = sha256(canonical.toString().getBytes(StandardCharsets.UTF_8));
      if (!MessageDigest.isEqual(HexFormat.of().parseHex(expected), HexFormat.of().parseHex(actual)))
        throw new IOException("Publication manifest identity mismatch");
      return new Manifest(files, expected);
    } catch (RuntimeException error) {
      // Parser errors may contain input values; do not echo them in application startup logs.
      throw invalid();
    }
  }

  static String sha256(byte[] bytes) throws IOException {
    try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
    catch (NoSuchAlgorithmException error) { throw new IOException("SHA-256 is unavailable", error); }
  }
  private static double number(JsonElement value) {
    return value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isNumber() ? value.getAsDouble() : Double.NaN;
  }
  private static boolean text(JsonElement value, int maximum) {
    return value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isString()
        && !value.getAsString().isEmpty() && value.getAsString().length() <= maximum;
  }
  private static boolean hash(JsonElement value) {
    return text(value, 64) && value.getAsString().matches("[a-f0-9]{64}");
  }
  private static boolean safePath(String value) {
    if (value.length() > 4096 || !value.matches("[a-zA-Z0-9][a-zA-Z0-9._/-]*")) return false;
    for (String part : value.split("/", -1)) if (part.isEmpty() || part.startsWith(".")) return false;
    return true;
  }
  private static JsonObject object(JsonElement value) throws IOException {
    require(value != null && value.isJsonObject());
    return value.getAsJsonObject();
  }
  private static JsonArray array(JsonElement value) throws IOException {
    require(value != null && value.isJsonArray());
    return value.getAsJsonArray();
  }
  private static void keys(JsonObject value, Set<String> allowed) throws IOException {
    require(allowed.containsAll(value.keySet()));
  }
  private static IOException invalid() { return new IOException("Invalid publication manifest metadata"); }
  private static void require(boolean condition) throws IOException { if (!condition) throw invalid(); }

  private static JsonElement readJson(JsonReader reader, int depth, int[] nodes) throws IOException {
    if (depth > 32 || ++nodes[0] > 1_000_000) throw new IOException("Publication manifest exceeds its JSON complexity limit");
    switch (reader.peek()) {
      case BEGIN_OBJECT: {
        reader.beginObject();
        var value = new JsonObject();
        while (reader.hasNext()) {
          String key = reader.nextName();
          if (value.has(key)) throw new IOException("Duplicate publication manifest property");
          value.add(key, readJson(reader, depth + 1, nodes));
        }
        reader.endObject(); return value;
      }
      case BEGIN_ARRAY: {
        reader.beginArray(); var value = new JsonArray();
        while (reader.hasNext()) value.add(readJson(reader, depth + 1, nodes));
        reader.endArray(); return value;
      }
      case STRING: return new JsonPrimitive(reader.nextString());
      case NUMBER: return new JsonPrimitive(new BigDecimal(reader.nextString()));
      case BOOLEAN: return new JsonPrimitive(reader.nextBoolean());
      case NULL: reader.nextNull(); return com.google.gson.JsonNull.INSTANCE;
      default: throw invalid();
    }
  }

  private static void canonical(JsonElement value, StringBuilder output) {
    if (value.isJsonObject()) {
      output.append('{'); boolean first = true;
      for (String key : new TreeSet<>(value.getAsJsonObject().keySet())) {
        if (!first) output.append(','); first = false;
        quote(key, output); output.append(':'); canonical(value.getAsJsonObject().get(key), output);
      }
      output.append('}');
    } else if (value.isJsonArray()) {
      output.append('['); boolean first = true;
      for (var item : value.getAsJsonArray()) {
        if (!first) output.append(','); first = false; canonical(item, output);
      }
      output.append(']');
    } else if (value.isJsonPrimitive() && value.getAsJsonPrimitive().isString()) quote(value.getAsString(), output);
    else output.append(value);
  }
  private static void quote(String value, StringBuilder output) {
    final String hex = "0123456789abcdef";
    output.append('"');
    for (int i = 0; i < value.length(); i++) {
      char c = value.charAt(i);
      switch (c) {
        case '"': output.append("\\\""); break;
        case '\\': output.append("\\\\"); break;
        case '\b': output.append("\\b"); break;
        case '\t': output.append("\\t"); break;
        case '\n': output.append("\\n"); break;
        case '\f': output.append("\\f"); break;
        case '\r': output.append("\\r"); break;
        default:
          if (c < 32 || Character.isHighSurrogate(c) && (i + 1 == value.length() || !Character.isLowSurrogate(value.charAt(i + 1)))
              || Character.isLowSurrogate(c) && (i == 0 || !Character.isHighSurrogate(value.charAt(i - 1)))) {
            output.append("\\u");
            for (int shift = 12; shift >= 0; shift -= 4) output.append(hex.charAt(c >> shift & 15));
          } else output.append(c);
      }
    }
    output.append('"');
  }

  private static final class LimitedInput extends FilterInputStream {
    private int bytes;
    LimitedInput(InputStream input) { super(input); }
    private void count(int size) throws IOException {
      bytes += size;
      if (bytes > MAX_BYTES) throw new IOException("Publication manifest exceeds 16 MiB");
    }
    @Override public int read() throws IOException {
      int value = in.read(); if (value != -1) count(1); return value;
    }
    @Override public int read(byte[] target, int offset, int length) throws IOException {
      int size = in.read(target, offset, Math.min(length, MAX_BYTES - bytes + 1));
      if (size > 0) count(size); return size;
    }
  }
}
