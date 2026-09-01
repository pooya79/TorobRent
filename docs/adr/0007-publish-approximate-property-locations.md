# Publish approximate Property locations

TorobRent publishes only a stable Approximate Location for a Property rather than exposing its
exact coordinates through public APIs. Public map coordinates identify an area of roughly 50
meters and the interface presents that uncertainty explicitly. A Submitter may provide an Exact
Location and an Operator may verify or adjust it, but it remains restricted data used to derive the
public location. Only the responsible Submitter and Operators with relevant review or catalog
capabilities may access an Exact Location; unrelated accounts, public APIs, and analytics receive
only the Approximate Location. A neighborhood-level location may be published with visibly lower
precision when no Exact Location is known, while Properties without usable coordinates remain
searchable without a map marker. This deliberately sacrifices building-level map precision because
exact residential locations cannot be made private again after disclosure.
