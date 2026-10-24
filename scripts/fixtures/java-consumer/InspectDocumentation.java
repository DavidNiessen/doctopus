import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Properties;
import java.util.jar.JarFile;

/** Verify attached source/API documentation archives without extracting archive paths. */
class InspectDocumentation {
  public static void main(String[] args) throws Exception {
    if (args.length != 6) throw new IllegalArgumentException("Expected archive, module, classifier, version and legal digests");
    Path file = Path.of(args[0]);
    String module = args[1], classifier = args[2], version = args[3];
    require(List.of("core", "spring-boot-starter").contains(module), "Unknown module");
    require(List.of("sources", "javadoc").contains(classifier), "Unknown classifier");
    require(Files.size(file) <= 10 * 1024 * 1024, "Oversized documentation archive");
    try (var jar = new JarFile(file.toFile())) {
      var names = new ArrayList<String>();
      var unique = new HashSet<String>();
      var entries = jar.entries();
      while (entries.hasMoreElements()) {
        String name = entries.nextElement().getName();
        require(names.size() < 500 && name.matches("[A-Za-z0-9_.$/-]+") && !name.startsWith("/")
            && !List.of(name.split("/")).contains("..") && unique.add(name), "Unsafe or duplicate documentation entry");
        require(!name.endsWith(".class") && !name.endsWith("Test.java"), "Runtime/test classes do not belong in documentation archives");
        names.add(name);
      }
      String legal = classifier.equals("sources") ? "META-INF/" : "resources/legal/";
      require(sha(content(jar, legal + "LICENSE")).equals(args[4]), "Source license is missing or changed");
      require(sha(content(jar, legal + "NOTICE")).equals(args[5]), "Source notice is missing or changed");
      String publicType = module.equals("core") ? "dev/niessen/doctopus/core/Publication" : "dev/niessen/doctopus/spring/DoctopusProperties";
      String metadata = "";
      if (classifier.equals("sources")) {
        require(unique.contains(publicType + ".java"), "Public sources are missing");
        String maven = "META-INF/maven/dev.niessen/doctopus-" + module + "/";
        var properties = new Properties();
        try (var input = jar.getInputStream(jar.getJarEntry(maven + "pom.properties"))) { properties.load(input); }
        require(version.equals(properties.getProperty("version")) && ("doctopus-" + module).equals(properties.getProperty("artifactId"))
            && "dev.niessen".equals(properties.getProperty("groupId")), "Source Maven coordinates disagree");
        metadata = ",\"pomSha256\":\"" + sha(content(jar, maven + "pom.xml")) + "\"";
      } else {
        require(unique.contains("index.html") && unique.contains(publicType + ".html"), "Public API documentation is missing");
        require(!names.stream().anyMatch(name -> name.endsWith(".java")), "Javadoc must not bundle source trees");
      }
      names.sort(String::compareTo);
      System.out.println("{\"entries\":[\"" + String.join("\",\"", names) + "\"]" + metadata + "}");
    }
  }
  private static byte[] content(JarFile jar, String name) throws Exception {
    var entry = jar.getJarEntry(name);
    require(entry != null && !entry.isDirectory(), "Missing archive entry: " + name);
    try (var input = jar.getInputStream(entry)) {
      byte[] bytes = input.readNBytes(2 * 1024 * 1024 + 1);
      require(bytes.length <= 2 * 1024 * 1024, "Oversized documentation entry");
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
