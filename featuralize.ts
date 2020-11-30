const fs = require('fs')

//  A Feature is the basic element of featuralization.
//  It has a name and a map of values. This lets us accommodate both UPSID-style descriptive features and PHOIBLE-style
//  binary features.
//  - In the UPSID style:
//    - the name is a feature slot (e.g. "place") 
//    - the values are the things that can occur in that slot (e.g. "labial", "coronal", etc.)
//  - In the PHOIBLE style:
//    - the name is a binary feature (e.g. "coronal")
//    - the values are '+' and '-'
//  Values are keys on the `values` object; this lets us model dependent features. For example, in PHOIBLE's
//  "Hayes-Prime" model, the feature "fortis" is only applicable to +consonantal segments. We can model this as follows:
//  {
//    name: "consonantal",
//    values: {
//      "+": [
//        {
//          name: "fortis",
//          values: { "+": [], "-": [] }
//        }
//      ],
//      "-": []
//    }
//  }
//
// Feature models are defined on a Root node with a single value called "Features". For a simple example:
// {
//    name: "Root",
//    values: {
//      "Features": [
//        {
//          name: "place",
//          values: { "labial" [], "coronal": ["dental", "alveolar", "postalveolar"], "velar": [] }
//        }, {
//          name: "manner",
//          values: { "plosive": [], "fricative": [], "nasal": [] }
//        }
//      ]
//    }
// }
type Feature = {
	name: string,
	values: {
		[value: string]: Array<Feature> // child features
	}
}
function get_children(feature: Feature) {
	let res: Map<string, Feature> = new Map()
	for (let value_name in feature.values) {
		for (let child_feature of feature.values[value_name]) {
			res.set(value_name, child_feature)
		}
	}
	return res
}

// Since features are a tree, we define a root node.
type Root = Feature & {
	name: "Root",
	values: {
		"Features": Array<Feature>
	}
}

type FeatureValue = {
	feature: Feature,
	value: string, // key of Feature.values
	// children: Array<FeatureValue> // corresponding to Feature.values[value]... why is this here?
}
type ValueRoot = FeatureValue & {
	feature: Root,
	value: "Features"
}

// Properties shared by all glyph rules.
// A glyph rule maps *glyph components* (base characters or modifiers) to *segments* (feature bundles).
// Klass (not the reserved word 'class') determines the character class of the glyph:
// - a base character (e.g. t)
// - a combining modifier (e.g. ̪ as in t̪)
// - a spacing modifier (e.g. ʰ as in tʰ)
// - a prefixal modifier (e.g. ʰ as in ʰt)
// Glyph is the character or character sequence itself. Glyphs need not be only a single character - theoretically,
// /kp/ could be handled as a sequence of base character and spacing modifier, but it's much simpler and more intuitive
// to treat /kp/ as a glyph that happens to consist of two codepoints.
type GlyphBase = {
	klass: "base" | "combining" | "spacing" | "prefixal",
	glyph: string
}

// A base character simply represents a bundle of features, which is stored from the root.
// Because they're stored from the root, diacritic application is a simple matter of applying patches to roots.
type BaseCharacter = GlyphBase & {
	klass: "base",
	features: Root
}

// When a diacritic is featuralized, it's tested orderlessly against every LHS rule; if the segment under
// featuralization matches a LHS, the RHS patch of features is applied.
// If multiple rules match, this should throw a runtime type error; I don't think there are any cases in which
// application of multiple rules from a single diacritic would be reasonable. This also ensures the irrelevance of 
// rule ordering.
// If the LHS doesn't ensure that all RHS features are reachable, that's a ~compile-time error.

// TODO: might it make sense to store the RHS as a root?
// Pro:
// - simpler diffs?
// Con:
// - more verbosity
// - modifiers will surely be specified as arrays of features, so more transformation overheads
type Modifier = GlyphBase & {
	klass: "combining" | "spacing" | "prefixal",
	rules: Map<Array<FeatureValue>, Array<FeatureValue>>
}
type GlyphRule = BaseCharacter | Modifier

// A parsed glyph is an array of characters.
type Glyph = Array<string>

type Segment = {
	glyph: string,
	features: Root
}

class FeatureSchema {
	raw_schema: Root
	features_by_name: Map<string, Feature> // map from name of feature to feature
	features_by_parent: Map<string, FeatureValue> // map from name of feature to {feature: parent, value: branch_to_child}

	constructor(root_feature: Root) {
		this.raw_schema = root_feature

		// build features_by_name
		this.features_by_name = new Map()
		const build_features_by_name = (f: Feature) => {
			if (this.features_by_name.has(f.name)) throw new Error(`Ambiguous feature name: ${f.name}`)
			this.features_by_name.set(f.name, f)
			for (let cf_value in f.values) {
				let cf_descendants = f.values[cf_value]
				console.log(cf_descendants)
				for (let cf of cf_descendants) {
					build_features_by_name(cf)
				}
			}
		}
		build_features_by_name(root_feature)

		this.features_by_parent = new Map()
		const build_features_by_parent = (f: Feature) => {
			// we start with the root, which doesn't have a parent
			for (let value_name in f.values) {
				let children = f.values[value_name]
				let value: FeatureValue = {feature: f, value: value_name}
				for (let child of children) {
					this.features_by_parent.set(child.name, value)
					build_features_by_parent(child)
				}
			}	
		}
		build_features_by_parent(root_feature)
	}
	
	// Get a feature by name.
	get(name: string) {
		const res = this.features_by_name.get(name)
		if (res === undefined) throw new Error(`Undefined get for ${name}`)
		return res
	}
	get_parent(name: string) {
		const res = this.features_by_parent.get(name)
		if (res === undefined) throw new Error(`Undefined get_parent for ${name}`)
		return res
	}

	// Ensure that a modifier ruleset is well-formed: the LHS ensures that all RHS features are reachable.
	// For example, in Hayes-Prime, if the RHS sets [+anterior], the LHS must set [+coronal], because [±anterior] 
	// is a descendant of [+coronal]: only [+coronal] segments can have the [±anterior] feature.
	// For a feature value in RHS to be reachable, one of these things must hold:
	// - its feature must be an immediate descendant of root (not "derived")  (e.g. root -> +long)
	// - the RHS feature is also the LHS feature                              (e.g. -labiodental -> +labiodental)
	// - the RHS is a sibling of LHS                                          (e.g. +anterior -> +distributed)
	// - the LHS must contain the correct feature of its immediate descendant (e.g. +coronal -> +anterior)
	// This is untested and almost certainly extremely wrong. Need to write parser for rules first.
	typecheck(modifier: Modifier) {
		let root_children = new Set(this.raw_schema.values.Features.map(x => x.name))
 
		for (let rule of modifier.rules) {
			console.log(JSON.stringify(rule))
			const lhs = rule[0]
			const rhs = rule[1]

			// Any child of the root feature is always accessible, so we don't need to check.
			let derived_rhs_features = rhs.filter(x => !root_children.has(x.feature.name))
			// If the LHS and RHS are identical, we don't need to check.
			const lhs_feature_names = new Set(lhs.map(x => x.feature.name))
			derived_rhs_features = derived_rhs_features.filter(x => !lhs_feature_names.has(x.feature.name))
			// If the LHS and RHS are siblings (have the same parent and the same descendance value), we don't need to check.
			const lhs_feature_parents = new Set(lhs.map(x => this.get_parent(x.feature.name)))
			derived_rhs_features = derived_rhs_features.filter(x =>
				!lhs_feature_parents.has( this.get_parent(x.feature.name) )
			)

			// Otherwise, check to see if LHS contains a parent of RHS, with the right branch to RHS.
			for (let derived_rhs_feature of derived_rhs_features) {
				const rhs_parent = this.features_by_parent.get(derived_rhs_feature.feature.name)
				if (rhs_parent === undefined) throw new Error("Undefined RHS parent (this should never happen)")
				
				if (!lhs.some(fval => 
					fval.feature.name === rhs_parent.feature.name && fval.value === rhs_parent.value
				)) throw new Error(`Invalid rule ${JSON.stringify(rule)} for ${modifier.glyph}`)
			}
		}
	}
}

class Featuralizer {
	// An unedited reference to the feature schema.
	feature_schema: FeatureSchema

	// Probably want to get everything defined here.
	// Maybe later we'll have a factory function or something.
	constructor(feature_schema: FeatureSchema) {
		this.feature_schema = feature_schema
	}

	// Declare a feature schema, i.e. a specific model, such as PHOIBLE's "Hayes Prime".
	load_feature_schema(_features: Root): void {
		
	}

	// Declare a glyph rule. Insertion order matters: we'll standardize characters by reordering their components.
	declare_glyph_rule(_rule: GlyphRule): void {

	}

	// Parse a string into a sequence of glyphs.
	parse(_glyph: string)/*: Array<string> */ {

	}

	// Normalize a glyph - reorder its components.
	normalize(_glyph: Glyph)/*: string */ {
	}

	// Transform a glyph (a sequence of characters) into a segment (a feature bundle).
	featuralize(_glyph: string)/*: Segment */ {
		// TODO
	}
}

function parse_feature_schema(path: string): FeatureSchema {
	const raw: any = fs.readFileSync(path)
	let data: any = JSON.parse(raw)

	const is_binary = true
	const validate_feature = (feature: any, top_level = true) => {
		if (!feature.hasOwnProperty('name')) throw new Error('Feature with no name')
		if (!feature.hasOwnProperty('values')) throw new Error(`Feature with no values: ${feature.name}`)
		if (!top_level && is_binary && !(
			Object.keys(feature.values).length === 2 && 
			feature.values.hasOwnProperty('+') && feature.values.hasOwnProperty('-'))
		) throw new Error(`Non-binary feature: ${feature.name}`)
		let descendants: any[] = []
		for (let v in feature.values) descendants = descendants.concat(feature.values[v])
		descendants.map(f => validate_feature(f, false))
	}
	data.map((f: any) => validate_feature(f))

	const root: Root = {
		name: 'Root',
		values: {
			'Features': data as Feature[]
		}
	}

	return new FeatureSchema(root)
}

// test stuff
const schema = parse_feature_schema('featuresets/hayes_prime.json')

// This should work.
const rules = new Map([
	[ 
		[ 
			{feature: schema.get('coronal') as Feature, value: '+'} as FeatureValue
		],
	  	[
	  		{feature: schema.get('anterior') as Feature, value: '+'} as FeatureValue
	  	]
	],
	[
		[ 
			{feature: schema.get('labiodental') as Feature, value: '-'} as FeatureValue
		],
		[ 
			{feature: schema.get('labiodental') as Feature, value: '+'} as FeatureValue
		]
	],
	[
		[
			{feature: schema.get('spread_glottis') as Feature, value: '+'} as FeatureValue
		], 
		[
			{feature: schema.get('long') as Feature, value: '+'} as FeatureValue
		]
	],
	[
		[
			{feature: schema.get('anterior') as Feature, value: '+'} as FeatureValue
		],
		[
			{feature: schema.get('distributed') as Feature, value: '+'} as FeatureValue
		]
	]
])
schema.typecheck({
  klass: "combining",
  glyph: "test",
  rules: rules
})

console.log(' ---- everything that should work works ---- ')

// This should *not* work.
schema.typecheck({
	klass: "combining", glyph: "test2",
	rules: new Map([[
		[ 
			{ feature: schema.get('coronal'), value: '-' } 
		],
		[
			{ feature: schema.get('distributed'), value: '+' }
		]
	]])
})