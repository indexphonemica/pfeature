import { FeatureSchema } from './feature_schema'
import { Ruleset } from './ruleset'

// read these from the command line at some point
const features_path = 'featuresets/simple.json'
const rules_path    = 'featuresets/simple.rule'
const segments_path = 'featuresets/simple.segs'

const schema = new FeatureSchema(features_path)
const rules  = new Ruleset(rules_path, schema)

