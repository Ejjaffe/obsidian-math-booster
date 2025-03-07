import { RangeSetBuilder, RangeSet, RangeValue } from '@codemirror/state';
import { syntaxTree } from "@codemirror/language";
import { Decoration, DecorationSet, EditorView, PluginValue, ViewPlugin, ViewUpdate } from "@codemirror/view"

import { nodeText, matchTheoremCallout } from './utils';




export const CALLOUT = /HyperMD-callout_HyperMD-quote_HyperMD-quote-([1-9][0-9]*)/;
const CALLOUT_PRE_TITLE = (level: number) => new RegExp(`formatting_formatting-quote_formatting-quote-${level}_hmd-callout_quote_quote-${level}`);
export const BLOCKQUOTE = (level: number) => `HyperMD-quote_HyperMD-quote-${level}`


class DummyRangeValue extends RangeValue { } // only for creating atomic ranges, so don't care the actual value


export const theoremCalloutMetadataHiderPlulgin = ViewPlugin.fromClass(
    class implements PluginValue {
        decorations: DecorationSet;
        atomicRanges: RangeSet<DummyRangeValue>;

        constructor(view: EditorView) {
            this.impl(view);
        }
        update(update: ViewUpdate) {
            if (update.docChanged || update.viewportChanged) {
                this.impl(update.view);
            }
        }
        impl(view: EditorView) {
            const decorationBuilder = new RangeSetBuilder<Decoration>();
            const atomicRangeBuilder = new RangeSetBuilder<DummyRangeValue>();
            const tree = syntaxTree(view.state);

            for (const { from, to } of view.visibleRanges) {
                tree.iterate({
                    from,
                    to,
                    enter(node) {
                        const match = node.name.match(CALLOUT);
                        if (match) {
                            const level = +match[1];
                            const calloutPreTitleNode = node.node.firstChild;
                            if (calloutPreTitleNode?.name.match(CALLOUT_PRE_TITLE(level))) {
                                const text = nodeText(calloutPreTitleNode, view.state);
                                if (matchTheoremCallout(text)) {
                                    decorationBuilder.add(
                                        calloutPreTitleNode.from + 2,
                                        calloutPreTitleNode.to,
                                        Decoration.replace({})
                                    );
                                    atomicRangeBuilder.add(
                                        calloutPreTitleNode.from + 2,
                                        node.to,
                                        new DummyRangeValue()
                                    );
                                }
                            }
                        }
                    }
                })
            }
            this.decorations = decorationBuilder.finish();
            this.atomicRanges = atomicRangeBuilder.finish();
        }

    }, {
    decorations: instance => instance.decorations,
    provide: plugin => EditorView.atomicRanges.of(view => {
        return view.plugin(plugin)?.atomicRanges ?? Decoration.none
    })
});
