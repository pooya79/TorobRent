# Use Neshan behind a map adapter

TorobRent uses Neshan's OpenLayers-based web map for its first interactive search map because its
Iran coverage and Persian presentation fit the marketplace better than assembling separate global
tile and geocoding services. Search code depends on a TorobRent-owned map adapter for viewports,
Property markers, clusters, Approximate Location circles, previews, and selection events rather
than depending directly on Neshan, preserving a practical path to another provider such as
MapLibre if commercial or operational constraints change.
