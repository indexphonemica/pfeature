// I don't have a design for a DSL for this, and it seems pretty tricky to get right.
// But the minimum viable featuralization script doesn't need it.
// So it's Typescript, but it gets its own file. For now...?

/** Assumes binary features. */
export function fold(it_raw: Map<string, string[]>) {
    // deep dup for good functional practice
    const it = new Map(
        [...it_raw.keys()].map(k => [k, [...it_raw.get(k)!]])
    )

    for (let k of it.keys()) {
        const values = it.get(k)!

        // Collapse adjacent identical features.
        const new_values: string[] = []
        let last_value: string = ''
        for (let value of values) {
            if (value !== last_value) {
                last_value = value
                new_values.push(value)
            }
        }

        it.set(k, new_values)

        // PHOIBLE doesn't do anything else, so maybe this is fine.
    }

    return it
}