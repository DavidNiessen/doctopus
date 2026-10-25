package dev.niessen.doctopus.spring;
import dev.niessen.doctopus.core.Publication;
import dev.niessen.doctopus.core.DirectDocumentation;
record DoctopusSite(Publication publication, DirectDocumentation direct, String basePath) {}
