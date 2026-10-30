package dev.niessen.doctopus.spring;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Configuration for the bundled API reference or a prebuilt publication behind host security. */
@ConfigurationProperties("doctopus")
public class DoctopusProperties {
  /** Whether to register the documentation integration. */
  private boolean enabled = true;
  /** Filesystem directory containing a prebuilt publication and its manifest. Selects prebuilt mode; omit it for direct OpenAPI URL mode. */
  private String directory;
  /** Application-relative mount path without a trailing slash, or / for application-root hosting. */
  private String path = "/docs";
  /** External documentation base path when a reverse proxy adds a prefix. In prebuilt mode it must match the compiled base path. */
  private String publicBasePath;
  /** Expected lowercase SHA-256 artifact digest from a trusted build inventory. A mismatch prevents startup. */
  private String artifactDigest;

  /** Browser-visible OpenAPI URL. Defaults to the active context's /v3/api-docs in direct mode. */
  private String url;
  /** Visible documentation header title. Defaults to the OpenAPI title. */
  private String title;
  /** Optional documentation site description for direct mode. */
  private String description;
  /** Prepared theme for direct mode: violet, ocean, ember or contrast (legacy mint/neutral remain accepted). */
  private String theme;
  /** Initial direct-mode layout: modern or classic. Visitor preferences take precedence. */
  private String layout;
  /** Initial appearance: system, light or dark. Visitor preferences take precedence. */
  private String appearance;
  /** Public HTTP(S) or relative URL of the default logo. */
  private String logo;
  /** Optional public URL of the dark-mode logo. Requires logo. */
  private String logoDark;
  /** Optional public HTTP(S) or relative URL of the favicon. */
  private String favicon;

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

  /** @return Browser-visible OpenAPI URL. Defaults to the active context's /v3/api-docs in direct mode. */
  public String getUrl() { return url; }
  /** @param value Browser-visible OpenAPI URL. Defaults to the active context's /v3/api-docs in direct mode. */
  public void setUrl(String value) { url = value; }
  /** @return Visible documentation header title. Defaults to the OpenAPI title. */
  public String getTitle() { return title; }
  /** @param value Visible documentation header title. Defaults to the OpenAPI title. */
  public void setTitle(String value) { title = value; }
  /** @return Optional documentation site description for direct mode. */
  public String getDescription() { return description; }
  /** @param value Optional documentation site description for direct mode. */
  public void setDescription(String value) { description = value; }
  /** @return Prepared theme for direct mode: violet, ocean, ember or contrast (legacy mint/neutral remain accepted). */
  public String getTheme() { return theme; }
  /** @param value Prepared theme for direct mode: violet, ocean, ember or contrast (legacy mint/neutral remain accepted). */
  public void setTheme(String value) { theme = value; }
  /** @return Initial direct-mode layout: modern or classic. Visitor preferences take precedence. */
  public String getLayout() { return layout; }
  /** @param value Initial direct-mode layout: modern or classic. Visitor preferences take precedence. */
  public void setLayout(String value) { layout = value; }
  /** @return Initial appearance: system, light or dark. Visitor preferences take precedence. */
  public String getAppearance() { return appearance; }
  /** @param value Initial appearance: system, light or dark. Visitor preferences take precedence. */
  public void setAppearance(String value) { appearance = value; }
  /** @return Public HTTP(S) or relative URL of the default logo. */
  public String getLogo() { return logo; }
  /** @param value Public HTTP(S) or relative URL of the default logo. */
  public void setLogo(String value) { logo = value; }
  /** @return Optional public URL of the dark-mode logo. Requires logo. */
  public String getLogoDark() { return logoDark; }
  /** @param value Optional public URL of the dark-mode logo. Requires logo. */
  public void setLogoDark(String value) { logoDark = value; }
  /** @return Optional public HTTP(S) or relative URL of the favicon. */
  public String getFavicon() { return favicon; }
  /** @param value Optional public HTTP(S) or relative URL of the favicon. */
  public void setFavicon(String value) { favicon = value; }
  java.util.Map<String,String> directOptions() {
    var result = new java.util.LinkedHashMap<String,String>();
    if (url != null) result.put("url", url);
    if (title != null) result.put("title", title);
    if (description != null) result.put("description", description);
    if (theme != null) result.put("theme", theme);
    if (layout != null) result.put("layout", layout);
    if (appearance != null) result.put("appearance", appearance);
    if (logo != null) result.put("logo", logo);
    if (logoDark != null) result.put("logoDark", logoDark);
    if (favicon != null) result.put("favicon", favicon);
    return result;
  }

  String mountPrefix() {
    if (path == null || !(path.equals("/") || path.matches("/[a-zA-Z0-9][a-zA-Z0-9/_-]*") && !path.endsWith("/"))) {
      throw new IllegalArgumentException("doctopus.path must be / or an absolute mount path without a trailing slash");
    }
    return path.equals("/") ? "" : path;
  }
}
