# Cache Provenance Checklist

A generated cache or index should record:

- source file paths and versions
- genome build / coordinate conventions
- contig naming assumptions
- build command or config
- schema / encoding version
- software version that generated the cache
- any lossy encoding choices
- regeneration instructions

A cache without provenance becomes technical debt quickly.
