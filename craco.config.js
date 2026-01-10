const HtmlWebpackPlugin = require("html-webpack-plugin");
const MonacoWebpackPlugin = require("monaco-editor-webpack-plugin");

module.exports = {
    webpack: {
        configure: (webpackConfig, { env, paths }) => {
            return {
                ...webpackConfig,
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
                    ...webpackConfig.plugins,
                    new HtmlWebpackPlugin({
                        inject: true,
                        chunks: ["options"],
                        template: paths.appHtml,
                        filename: 'options.html',
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
