# Validation Notes for One-Pass Analytics

Validate separately:

- main output correctness
- each extra statistic
- edge cases on empty/small inputs
- filtered vs unfiltered behavior
- compatibility-critical outputs against upstream reference tools
- benchmark against the original multi-pass workflow

A fast fused pass is only useful if each emitted number can be trusted.
