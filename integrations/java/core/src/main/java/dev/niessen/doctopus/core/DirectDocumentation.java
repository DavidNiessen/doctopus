package dev.niessen.doctopus.core;

import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Bundled browser UI configured with a public OpenAPI URL. No server-side spec download. */
public final class DirectDocumentation {
  private static final String ROOT = "/META-INF/doctopus/reader/";
  private final Map<String, byte[]> assets = new LinkedHashMap<>();
  private final byte[] html;
  private final String basePath;

  /**
   * Configure the shared Reader and verify its bundled asset inventory.
   * @param options public url, title, description, theme, layout, appearance and branding URLs
   * @param basePath external documentation mount, empty for the origin root
   * @throws IOException if bundled assets are absent or corrupted
   */
  public DirectDocumentation(Map<String, String> options, String basePath) throws IOException {
    if (basePath == null || !(basePath.isEmpty() || basePath.matches("/[a-zA-Z0-9][a-zA-Z0-9/_-]*") && !basePath.endsWith("/")))
      throw new IllegalArgumentException("Invalid documentation base path");
    this.basePath = basePath;
    var config = new LinkedHashMap<String, String>();
    config.put("basePath", basePath);
    config.put("url", options.getOrDefault("url", "/v3/api-docs"));
    config.put("theme", options.getOrDefault("theme", "violet"));
    config.put("layout", options.getOrDefault("layout", "modern"));
    config.put("appearance", options.getOrDefault("appearance", "system"));
    if (!Set.of("violet", "mint", "ocean", "neutral", "ember", "contrast").contains(config.get("theme"))
        || !Set.of("modern", "classic").contains(config.get("layout"))
        || !Set.of("system", "light", "dark").contains(config.get("appearance")))
      throw new IllegalArgumentException("Unsupported documentation theme, layout or appearance");
    for (String key : new String[]{"url", "logo", "logoDark", "favicon"}) {
      String value = key.equals("url") ? config.get(key) : options.get(key);
      if (value == null) continue;
      validateUrl(value);
      config.put(key, value);
    }
    for (String key : new String[]{"title", "description"}) {
      String value = options.get(key);
      if (value == null) continue;
      if (value.isBlank() || value.length() > (key.equals("title") ? 100 : 500))
        throw new IllegalArgumentException("Invalid documentation " + key);
      config.put(key, value);
    }
    if (config.containsKey("logoDark") && !config.containsKey("logo"))
      throw new IllegalArgumentException("A dark logo requires a default logo");
    var gson = new Gson();
    Map<String, String> inventory = gson.fromJson(new String(resource("direct-assets.json"), StandardCharsets.UTF_8),
        new TypeToken<Map<String, String>>() {}.getType());
    if (inventory == null || inventory.isEmpty() || inventory.size() > 500)
      throw new IOException("Invalid bundled Reader inventory");
    for (var entry : inventory.entrySet()) {
      if (!entry.getKey().matches("assets/[A-Za-z0-9][A-Za-z0-9._-]*") || !entry.getValue().matches("[a-f0-9]{64}"))
        throw new IOException("Invalid bundled Reader asset entry");
      byte[] content = resource(entry.getKey());
      try {
        String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
        if (!hash.equals(entry.getValue())) throw new IOException("Bundled Reader asset integrity check failed");
      } catch (NoSuchAlgorithmException error) { throw new IOException("SHA-256 unavailable", error); }
      assets.put(entry.getKey(), content);
    }
    String template = new String(resource("direct.html"), StandardCharsets.UTF_8);
    Map<String, String> values = Map.of("TITLE", escape(config.getOrDefault("title", "API Reference")),
        "BASE", escape(basePath), "CONFIG", gson.toJson(config));
    Matcher matcher = Pattern.compile("__DOCTOPUS_(TITLE|BASE|CONFIG)__").matcher(template);
    var result = new StringBuilder();
    while (matcher.find()) matcher.appendReplacement(result, Matcher.quoteReplacement(values.get(matcher.group(1))));
    matcher.appendTail(result);
    html = result.toString().getBytes(StandardCharsets.UTF_8);
  }
  private static void validateUrl(String value) {
    if (value.isEmpty() || value.length() > 4096 || value.matches("(?s).*[\\s\\p{Cntrl}\\\\].*"))
      throw new IllegalArgumentException("Invalid documentation URL");
    try {
      URI url = URI.create("https://doctopus.invalid/docs/").resolve(value);
      if (!("http".equals(url.getScheme()) || "https".equals(url.getScheme()))
          || url.getRawUserInfo() != null || url.getRawFragment() != null || url.getHost() == null)
        throw new IllegalArgumentException("Invalid documentation URL");
    } catch (IllegalArgumentException error) { throw new IllegalArgumentException("Invalid documentation URL"); }
  }
  private static String escape(String value) {
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        .replace("\"", "&quot;").replace("'", "&#39;");
  }
  private static byte[] resource(String name) throws IOException {
    try (var stream = DirectDocumentation.class.getResourceAsStream(ROOT + name)) {
      if (stream == null) throw new IOException("Bundled Reader missing; build the Reader before packaging the Java integration");
      byte[] bytes = stream.readNBytes(16 * 1024 * 1024 + 1);
      if (bytes.length > 16 * 1024 * 1024) throw new IOException("Bundled Reader resource exceeds limit");
      return bytes;
    }
  }
  /** @return the external documentation base path */
  public String basePath() { return basePath; }
  /** @param path application-relative resource path, with or without a leading slash
   * @return whether this is a supported browser navigation route */
  public boolean isDocument(String path) {
    String value = path.startsWith("/") ? path : "/" + path;
    return value.equals("/") || value.equals("/index.html")
        || value.matches("/api/[^/.][^/]*/[^/.][^/]*/[^/.][^/]*/?");
  }
  /** @param path application-relative resource path
   * @return a copy of the shell/asset bytes, or null for a non-public path */
  public byte[] read(String path) {
    byte[] bytes = isDocument(path) ? html : assets.get(path.startsWith("/") ? path.substring(1) : path);
    return bytes == null ? null : bytes.clone();
  }
}
