# Echtvar Notes

`echtvar` is a strong example of a specialized annotation-serving format.

Useful design ideas from inspection:

- fixed genome chunking (`1 << 20` bases)
- compact 32-bit encoding for many small variants
- supplemental store for long variants that do not fit the compact encoding
- delta-encoded integer streams
- stream-vbyte compression
- per-field payload storage
- low-cardinality string coding with lookup tables
- zip archive as container for chunk payloads and metadata

This kind of design is appealing when repeated annotation against large reference datasets dominates and mainstream interchange formats become too expensive operationally.
