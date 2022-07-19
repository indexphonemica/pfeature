- There's no good way to write unconditional rules
  - What does this mean?

- Probably don't want to be throwing errors everywhere - log errors and list all at once instead to avoid whackamole

- Rules should make sure not to create impossible feature sets - if you remove a node you should also remove its children
  - Important for ternaries (e.g. high and low - +high +low is forbidden, so low can be a child of -high or vice versa)

- Noncomprehensive bundle checking
  - What does this mean?

- Output to file

- Normalization
  - We have a canonical total ordering of diacritics: use the character class, then use however they're defined

- Handle multi-unit segments
  - How should folding rules be defined?
    - UPSID: a diphthong is high if it contains a high unit segment (/ai/, /ia/)
    - PHOIBLE: +high is a different sort of thing from +,-high (/ai/ does not share a height feature with either /a/ or /i/)
    - IPHON: ???
      - Could get both the UPSID and the PHOIBLE model with better search - e.g. +high (contains a +high at some point) vs. =high (is always high)
        - +high returns /i ai ia/; =high returns only /i/
      - Except the PHOIBLE model is *ternary*, so you need some way to make this distinction consistently

- Handle feature propagation (we write X-SAMPA a_ti_^ instead of a_ti_t_^, but the whole diphthong is breathy)
  - Are there features that don't propagate?
    - Yes, Chong creaky-breathy vowels. But these features are incompatible, so we can resolve it to a multi-unit segment. This resolution should print a warning, though.

- Testing?
  - This is a single-purpose program so we can just inspect all its IPHON outputs.