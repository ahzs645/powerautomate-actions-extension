const HtmlWebpackPlugin = require("html-webpack-plugin");
const MonacoWebpackPlugin = require("monaco-editor-webpack-plugin");

module.exports = {
    webpack: {
        configure: (webpackConfig, { env, paths }) => {
            return {
                ...webpackConfig,
                resolve: {
                    ...webpackConfig.resolve,
                    fallback: {
                        ...webpackConfig.resolve?.fallback,
                        path: require.resolve('path-browserify'),
                    },
                },
                entry: {
                    main: [env === 'development' &&
                        require.resolve('react-dev-utils/webpackHotDevClient'), paths.appIndexJs].filter(Boolean),
                    'flow-editor': paths.appSrc + '/flow-editor.tsx',
                    content: paths.appSrc + '/chrome/Content.ts',
                    background: paths.appSrc + '/chrome/Background.ts'
                },
                output: {
                    ...webpackConfig.output,
                    filename: (pathData) => {
                        const name = pathData.chunk.name.toLowerCase();
                        return `static/js/${name}.js`;
                    },
                },
                optimization: {
                    ...webpackConfig.optimization,
                    runtimeChunk: false,
                },
                plugins: [
                    // Drop CRA's default HtmlWebpackPlugin: it has no chunks filter,
                    // so the popup (index.html) would load every entry — including a
                    // second copy of the background service worker and Monaco.
                    ...webpackConfig.plugins.filter(
                        (plugin) => plugin.constructor.name !== 'HtmlWebpackPlugin'
                    ),
                    new HtmlWebpackPlugin({
                        inject: true,
                        chunks: ["main"],
                        template: paths.appHtml,
                        filename: 'index.html',
                    }),
                    new HtmlWebpackPlugin({
                        inject: true,
                        chunks: ["main"],
                        template: paths.appPublic + '/sidepanel.html',
                        filename: 'sidepanel.html',
                    }),
                    new HtmlWebpackPlugin({
                        inject: true,
                        chunks: ["flow-editor"],
                        template: paths.appPublic + '/flow-editor.html',
                        filename: 'flow-editor.html',
                    }),
                    new MonacoWebpackPlugin({
                        languages: ['json'],
                        features: ['bracketMatching', 'caretOperations', 'clipboard', 'find', 'folding', 'format', 'hover', 'inPlaceReplace', 'linesOperations', 'suggest']
                    })
                ]
            }
        },
    }
}
