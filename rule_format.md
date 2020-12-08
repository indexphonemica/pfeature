# General notes

PFEATURE does not tolerate implicit nulls: every character must have an explicit value for every reachable feature. If you want null in your feature model, you'll have to make it explicit.

Examples here will use the "Hayes Prime" featureset used by PHOIBLE.

# Comments

If a `#` is encountered anywhere in a line, the rest of the line is ignored.

# Meta commands

Meta commands are formed with the `__meta` prefix, abbreviated `!`.

## default

`__meta default {value} : [features]` sets file-level defaults. Defaults are hoisted.

For example, `__meta default fortis : false` sets the default value of `fortis` to `-`, meaning that it isn't necessary to specify `-fortis`.

## alias

`__meta alias {name} : [features]` sets aliases, which are like variables except immutable. Aliases can be used instead of feature values in glyph definitions, but must be prefixed with the sigil `*`. Alias definitions are hoisted in one step: base and modifier definitions can use alias definitions that appear later in the file, but other alias definitions can't.

For example:
```
__meta default false : fortis constricted_glottis spread_glottis long stress tone
__meta alias plosive : -nasal -approximant -sonorant -delayed_release -syllabic -trill -tap -lateral -continuant +consonantal
__meta alias bilabial : -coronal -dorsal -labiodental -round +labial

p : *bilabial *plosive -voice
b : *bilabial *plosive +voice
```

You can also use `__meta setalias {name} {value} : {features}`, similarly to the `default` command.

# Base characters 

`= {glyph} : [features]` defines a base character. (`base` may be used as an alternative to `=`.)

For example, `= m : -approximant -clock +consonantal -constricted_glottis -continuant -coronal -dorsal -ejective -fortis -implosive +labial -labiodental -lateral -long +nasal -round -short +sonorant -spread_glottis -stress -syllabic -tap -trill +voice` defines /m/ as a bilabial nasal.

Base characters may consist of more than one codepoint - e.g. /tɕ/ or /kp/.

## Derivations

`=* {glyph} {glyph} : [features]` defines a base character as a derivation of another base character: the deltas to the right of `:` are applied to the second glyph to produce the feature bundle of the first glyph. (`derive` may be used as an alternative to `=*`.)

For example, `= m̥ m : -voice` defines /m̥/ as a voiceless /m/.

# Diacritics

There are three types of diacritic: prefixal, suffixal, and combining. In the complex glyph <ⁿt̠ʰ>, the IPA representation of a prenasalized aspirated voiceless postalveolar plosive, <ⁿ> is a prefixal diacritic, <ʰ> is a suffixal diacritic, and the underdash ◌̠ is a combining diacritic. The three types are defined differently.

PFEATURE normalizes complex glyphs - that is, it ensures that diacritics in the output appear in a consistent order. The order is inferred from the order of definition: if `ʲ` is defined before `ʰ` in the rules file, `pʰʲ` in the input will be rewritten to `pʲʰ` in the output.

When a glyph to be featuralized is encountered which is not a base character, PFEATURE will try to interpret it as a sequence of a base character and one or more diacritics. Matching is greedy in all cases: if `tʰ` is defined as a base character, and `t` and `ʰ` are defined as modifiers, PFEATURE will interpret `tʰ` in the input as a unitary base character. If a character cannot be interpreted as a sequence of base characters and modifiers, PFEATURE will abort with a runtime error.

Diacritics are defined as *functions* from inputs to deltas, much like functions in languages like Haskell. The same diacritic may be given two different definitions: for example, <◌̪> (the dental diacritic) may be defined as labiodentalization on labials and dentalization on alveolars, if (as in many feature systems) the deltas from the labial place to the labiodental and from the alveolar place to the dental are not identical. An example of the definition of the dental diacritic is given below.

All features in the right-hand side of a diacritic rule must be reachable from either those defined in the left-hand side or those defined elsewhere in the right-hand side, and no reachable features may be left out. For example, a rule `=> ~ +labial : -anterior` is invalid, because ±anterior is a child of +coronal and not reachable by +labial alone, but `=> ~ +coronal : -anterior` is valid, as is `=> ~ +labial : +coronal +anterior -distributed -strident`.

## Prefixal modifiers
Prefixal modifiers are those which appear before the base character, such as <ʰ> for preaspiration and <ⁿ> for prenasalization.

`<= {glyph} [features] : [features]` defines a prefixal modifier rule.

## Combining modifiers
Combining modifiers are those which appear above or below the base character, such as <◌̠> for retraction.

`^= {glyph} [features] : [features]` defines a combining modifier. For combining modifiers, <◌> or <0> may be used as base characters, for ease of reading.

For example, a definition of the dental diacritic: 

```
◌̪ +labial : +labiodental
◌̪ +anterior -distributed : +distributed
```

(Note, however, that this relies on the fact that the dental diacritic is combining and the rounding diacritic <ʷ> is suffixal; if this were the other way around, the definition would be more complex, because /tʷ/ is +labial but /t̪ʷ/ is dental (i.e. +anterior +distributed) rather than +labiodental.)

## Suffixal modifiers
Suffixal modifiers are those which appear after the base character rule.

`=> {glyph} [features] : [features]` defines a suffixal modifier.

# Binary feature shorthand

For a binary featureset, `+` is treated as equivalent to `true`, and `-` is treated as equivalent to `false`. It is also possible to use `-name` as shorthand for `name:-` or `name:false`.

A similar shortcut should probably exist for `0` and `null`, but doesn't yet.