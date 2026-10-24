# Local Vega runtime
`npm run setup:charts` installs the versions pinned in `package-lock.json` with `npm ci`, then copies Vega, Vega-Lite, Vega-Embed and their licence notices here. The checked-in Vega licence matches the upstream `v5.33.1` licence because that npm package omits the licence file. Font assets are managed separately.
