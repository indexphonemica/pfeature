import { FeatureSchema } from './feature_schema'
import { Ruleset } from './ruleset'
import { Psegmentizer } from './psegmentizer'
import { print_warnings } from './util'

// read these from the command line at some point
const features_path = 'featuresets/simple.json'
const rules_path    = 'featuresets/simple.rule'
const segments_path = 'featuresets/simple.segs'

const schema = new FeatureSchema(features_path)
const rules  = new Ruleset(rules_path, schema)
const segments = new Psegmentizer(segments_path, rules)

segments.write('foo')

print_warnings()