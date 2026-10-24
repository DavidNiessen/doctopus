package dev.niessen.doctopus.spring;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Configuration for serving a prebuilt publication behind the application's security policy. */
@ConfigurationProperties("doctopus")
public class DoctopusProperties {
  /** Whether to register the documentation integration. */
  private boolean enabled = true;
  /** Filesystem directory containing a prebuilt publication and its manifest. Required when enabled. */
  private String directory;
  /** Application-relative mount path without a trailing slash, or / for application-root hosting. */
  private String path = "/docs";
  /** External publication base path when a reverse proxy adds a prefix. Must match the compiled base path. */
  private String publicBasePath;
  /** Expected lowercase SHA-256 artifact digest from a trusted build inventory. A mismatch prevents startup. */
  private String artifactDigest;

  /** Create the default configuration. */
  public DoctopusProperties() {}
  /** @return whether the integration is enabled */
  public boolean isEnabled() { return enabled; }
  /** @param value whether the integration is enabled */
  public void setEnabled(boolean value) { enabled = value; }
  /** @return the prebuilt publication directory, or null when unset */
  public String getDirectory() { return directory; }
  /** @param value the prebuilt publication directory */
  public void setDirectory(String value) { directory = value; }
  /** @return the application-relative mount path */
  public String getPath() { return path; }
  /** @param value the application-relative mount path without a trailing slash, or / for the root */
  public void setPath(String value) { path = value; }
  /** @return the external base path override, or null to use the context and mount paths */
  public String getPublicBasePath() { return publicBasePath; }
  /** @param value the external base path override, or null to use the context and mount paths */
  public void setPublicBasePath(String value) { publicBasePath = value; }
  /** @return the optional trusted artifact digest */
  public String getArtifactDigest() { return artifactDigest; }
  /** @param value a trusted lowercase SHA-256 digest, or null to omit the identity pin */
  public void setArtifactDigest(String value) { artifactDigest = value; }

  String mountPrefix() {
    if (path == null || !(path.equals("/") || path.matches("/[a-zA-Z0-9][a-zA-Z0-9/_-]*") && !path.endsWith("/"))) {
      throw new IllegalArgumentException("doctopus.path must be / or an absolute mount path without a trailing slash");
    }
    return path.equals("/") ? "" : path;
  }
}
