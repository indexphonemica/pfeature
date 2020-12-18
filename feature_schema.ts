import * as fs from 'fs'

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
		[value: string]: Array<Feature> // child features, or absent
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

export type FeatureValue = {
	feature: Feature,
	value: string, // key of Feature.values
}

// Keep it simple and don't get into the quagmire of object comparison.
export class FeatureBundle extends Map<string, string> { // map of feature name to feature value
	constructor(args: Iterable<[string, string]>) { super(args) }

	toString() {
		let str = ''
		for (let [k, v] of this) str += `${k}:${v} `
		return str
	}
}

// Properties shared by all glyph rules.
// A glyph rule maps *glyph components* (base characters or modifiers) to *segments* (feature bundles).
// Klass (not the reserved word 'class') determines the character class of the glyph:
// - a base character (e.g. t)
// - a combining modifier (e.g. ̪ as in t̪)
// - a suffixal modifier (e.g. ʰ as in tʰ)
// - a prefixal modifier (e.g. ʰ as in ʰt)
// Glyph is the character or character sequence itself. Glyphs need not be only a single character - theoretically,
// /kp/ could be handled as a sequence of base character and suffixal modifier, but it's much simpler and more intuitive
// to treat /kp/ as a glyph that happens to consist of two codepoints.
type GlyphBase = {
	klass: "base" | "combining" | "suffixal" | "prefixal",
	glyph: string
}

// A base character simply represents a bundle of features.
export type BaseCharacter = GlyphBase & {
	klass: "base",
	features: FeatureBundle
}

// When a diacritic is featuralized, it's tested orderlessly against every LHS rule; if the segment under
// featuralization matches a LHS, the RHS patch of features is applied.
// If multiple rules match, this should throw a runtime type error; I don't think there are any cases in which
// application of multiple rules from a single diacritic would be reasonable. This also ensures the irrelevance of 
// rule ordering.
// If the LHS doesn't ensure that all RHS features are reachable, that's a ~compile-time error.
export type ModifierRule = Map<FeatureBundle, FeatureBundle>
export type Modifier = GlyphBase & {
	klass: "combining" | "suffixal" | "prefixal",
	rules: ModifierRule
}

// A parsed glyph is an array of characters.
type Glyph = Array<string>

type Segment = {
	glyph: string,
	features: FeatureBundle
}

export class FeatureSchema {
	raw_schema: Root
	features_by_name: Map<string, Feature> // map from name of feature to feature
	features_by_parent: Map<string, FeatureValue> // map from name of feature to {feature: parent, value: branch_to_child}

	constructor(path: string) {
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
	
		let root_feature: Root = {
			name: 'Root',
			values: {
				'Features': data as Feature[]
			}
		}

		this.raw_schema = root_feature

		// build features_by_name
		this.features_by_name = new Map()
		const build_features_by_name = (f: Feature) => {
			if (this.features_by_name.has(f.name)) throw new Error(`Ambiguous feature name: ${f.name}`)
			this.features_by_name.set(f.name, f)
			for (let cf_value in f.values) {
				let cf_descendants = f.values[cf_value]
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

	// Ensure that a modifier rule is well-formed: the LHS ensures that all RHS features are reachable.
	// For example, in Hayes-Prime, if the RHS sets [+anterior], the LHS must set [+coronal], because [±anterior] 
	// is a descendant of [+coronal]: only [+coronal] segments can have the [±anterior] feature.
	// For a feature value in RHS to be reachable, one of these things must hold:
	// - its feature must be an immediate descendant of root (not "derived")  (e.g. root -> +long)
	// - the RHS feature is also the LHS feature                              (e.g. -labiodental -> +labiodental)
	// - the RHS is a sibling of LHS                                          (e.g. +anterior -> +distributed)
	// - the LHS must contain the correct feature of its immediate descendant (e.g. +coronal -> +anterior)
	// TODO: should also ensure that every possible feature in the tree has a value
	// (apply feature bundle, generate base, validate base)
	validate_modifier_rule(lhs_: FeatureBundle, rhs_: FeatureBundle, glyph: string) {
		let root_children = new Set(this.raw_schema.values.Features.map(x => x.name))

		const lhs = this.bundle_to_values(lhs_)
		const rhs = this.bundle_to_values(rhs_)

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
			)) throw new Error(`Invalid rule ${JSON.stringify(lhs)} : ${JSON.stringify(rhs)} for ${glyph}`)
		}
	}

	// Ensure that there are no nulls in a base char's feature tree.
	// Every child of root must be defined, as must every child of a defined value.
	// For example, with Hayes-Prime, there must be a value for ±coronal, and if that value is +,
	// there must be values for ±anterior, ±distributed, and ±strident.
	// TODO test this at all
	// TODO separate thing to test bundles that don't need to be comprehensive (aliases) - 
	//      everything should be reachable but not everything needs to exist
	validate_bundle(bundle: FeatureBundle, err_str?: string) {
		const top_level_features = this.raw_schema.values.Features
		let stack = top_level_features
		while (stack.length > 0) {
			let curr = stack.pop()
			if (curr === undefined) throw new Error(`Invalid bundle: popped undefined (this should never happen)`)
			let bundle_value = bundle.get(curr.name)
			if (bundle_value === undefined) {
				throw new Error(`Invalid bundle: missing ${curr.name} ${err_str ? `(${err_str})` : ''}`)
			}
			let children = curr.values[bundle_value]
			if (children === undefined) {
				throw new Error(`Invalid bundle: value ${bundle_value} not possible on feature ${curr.name} ${err_str ? `(${err_str})` : ''}`)
			}
			if (children.length > 0) stack.push(...children)
		}
	}

	bundle_to_values(bundle: FeatureBundle) {
		let res: FeatureValue[] = []
		for (let k of bundle.keys()) {
			let feature = this.features_by_name.get(k)
			if (feature === undefined) throw new Error(`Undefined feature ${k} in bundle_to_values`)
			let value = bundle.get(k)
			if (value === undefined || !feature.values.hasOwnProperty(value)) throw new Error(`Invalid feature/value pair ${k}/${value} in bundle_to_values`)
			res.push({feature, value})
		}
		return res
	}

	apply_modifier(base: FeatureBundle, modifier: FeatureBundle) {
		const keys = new Set( [...base.keys()].concat([...modifier.keys()]) )
		let res: FeatureBundle = new Map()
		for (let k of keys) {
			let val: string
			if (modifier.has(k)) {
				res.set( k, modifier.get(k) as string )
			} else {
				let v = base.get(k)
				if (v === undefined) throw new Error(`Couldn't find ${k} in apply_modifier`)
				res.set( k, v )
			}
		}
		this.validate_bundle(res, "Runtime error")
		return res
	}
}

// class Featuralizer {
// 	// An unedited reference to the feature schema.
// 	feature_schema: FeatureSchema

// 	// Probably want to get everything defined here.
// 	// Maybe later we'll have a factory function or something.
// 	constructor(feature_schema: FeatureSchema) {
// 		this.feature_schema = feature_schema
// 	}

// 	// Declare a feature schema, i.e. a specific model, such as PHOIBLE's "Hayes Prime".
// 	load_feature_schema(_features: Root): void {
		
// 	}

// 	// Declare a glyph rule. Insertion order matters: we'll standardize characters by reordering their components.
// 	declare_glyph_rule(_rule: GlyphRule): void {

// 	}

// 	// Parse a string into a sequence of glyphs.
// 	parse(_glyph: string)/*: Array<string> */ {

// 	}

// 	// Normalize a glyph - reorder its components.
// 	normalize(_glyph: Glyph)/*: string */ {
// 	}

// 	// Transform a glyph (a sequence of characters) into a segment (a feature bundle).
// 	featuralize(_glyph: string)/*: Segment */ {
// 		// TODO
// 	}
// }