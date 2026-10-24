import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Properties;
import java.util.jar.JarFile;

/** Inspect our own candidate archives without extracting archive paths to disk. */
class InspectJar {
  public static void main(String[] args) throws Exception {
    if (args.length != 5) throw new IllegalArgumentException("Expected jar, module, version and license/notice digests");
    Path file = Path.of(args[0]);
    String module = args[1], version = args[2];
    if (!List.of("core", "spring-boot-starter").contains(module)) throw new IllegalArgumentException("Unknown module");
    if (Files.size(file) > 10 * 1024 * 1024) throw new IllegalArgumentException("Unexpectedly large candidate JAR");
    try (var jar = new JarFile(file.toFile())) {
      var names = new ArrayList<String>();
      var unique = new HashSet<String>();
      int classes = 0;
      var entries = jar.entries();
      while (entries.hasMoreElements()) {
        var entry = entries.nextElement();
        String name = entry.getName();
        require(names.size() < 250 && name.matches("[A-Za-z0-9_.$/-]+") && !name.startsWith("/")
            && !List.of(name.split("/")).contains("..") && unique.add(name), "Unsafe or duplicate archive entry");
        names.add(name);
        require(!name.contains("Test.class") && !name.startsWith("node_modules/") && !name.endsWith(".java"),
            "Tests and source files do not belong in a runtime JAR");
        if (name.endsWith(".class")) {
          require(name.startsWith("dev/niessen/doctopus/"), "Unexpected bundled dependency classes");
          byte[] header = content(jar, name);
          require(header.length >= 8 && header[0] == (byte) 0xca && header[1] == (byte) 0xfe
              && header[2] == (byte) 0xba && header[3] == (byte) 0xbe
              && ((header[6] & 255) * 256 + (header[7] & 255)) == 61, "Classes must target Java 17");
          classes++;
        }
      }
      require(classes > 0, "Candidate has no runtime classes");
      require(sha(content(jar, "META-INF/LICENSE")).equals(args[3]), "License differs from the source license");
      require(sha(content(jar, "META-INF/NOTICE")).equals(args[4]), "Notice differs from the source notice");
      String artifact = "doctopus-" + module;
      String maven = "META-INF/maven/dev.niessen/" + artifact + "/";
      var properties = new Properties();
      try (var input = jar.getInputStream(jar.getJarEntry(maven + "pom.properties"))) { properties.load(input); }
      require(version.equals(properties.getProperty("version")) && artifact.equals(properties.getProperty("artifactId"))
          && "dev.niessen".equals(properties.getProperty("groupId")), "Embedded Maven coordinates disagree");
      require(unique.contains(module.equals("core") ? "dev/niessen/doctopus/core/Publication.class"
          : "dev/niessen/doctopus/spring/DoctopusAutoConfiguration.class"), "Missing public runtime entrypoint");
      if (module.equals("spring-boot-starter")) {
        require(new String(content(jar, "META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports"),
            java.nio.charset.StandardCharsets.UTF_8).trim().equals("dev.niessen.doctopus.spring.DoctopusAutoConfiguration"),
            "Missing automatic Spring Boot discovery metadata");
      }
      names.sort(String::compareTo);
      String metadata = module.equals("spring-boot-starter")
          ? ",\"configurationMetadataBase64\":\"" + java.util.Base64.getEncoder().encodeToString(
              content(jar, "META-INF/spring-configuration-metadata.json")) + "\"" : "";
      System.out.println("{\"entries\":[\"" + String.join("\",\"", names)
          + "\"],\"classes\":" + classes + ",\"bytecodeMajor\":61,\"pomSha256\":\""
          + sha(content(jar, maven + "pom.xml")) + "\"" + metadata + "}");
    }
  }
  private static byte[] content(JarFile jar, String name) throws Exception {
    var entry = jar.getJarEntry(name);
    require(entry != null && !entry.isDirectory(), "Missing required archive entry: " + name);
    try (var input = jar.getInputStream(entry)) {
      byte[] bytes = input.readNBytes(2 * 1024 * 1024 + 1);
      require(bytes.length <= 2 * 1024 * 1024, "Oversized archive entry");
      return bytes;
    }
  }
  private static String sha(byte[] bytes) throws Exception {
    return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
  }
  private static void require(boolean condition, String message) {
    if (!condition) throw new IllegalArgumentException(message);
  }
}
