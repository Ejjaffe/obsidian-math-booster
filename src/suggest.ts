import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, TFile, prepareFuzzySearch, sortSearchResults, SearchResult, Notice, prepareSimpleSearch, renderMath, finishRenderMath, getAllTags } from "obsidian";

import MathBooster from "./main";
import { findSectionCache, formatLabel, getModifierNameInPlatform, insertBlockIdIfNotExist, openFileAndSelectPosition, resolveSettings } from './utils';
import { IndexItem, IndexItemType, NoteIndex } from "./indexer";
import { DEFAULT_EXTRA_SETTINGS, LEAF_OPTION_TO_ARGS } from "./settings/settings";


export class Suggest extends EditorSuggest<IndexItem> {
    constructor(public app: App, public plugin: MathBooster, public types: IndexItemType[]) {
        super(app);

        // Mod (by default) + Enter to jump to the selected item
        this.scope.register([this.plugin.extraSettings.modifierToJump], "Enter", () => {
            if (this.context) {
                const {editor, start, end} = this.context;
                editor.replaceRange("", start, end);
            }
            // Reference: https://github.com/tadashi-aikawa/obsidian-various-complements-plugin/blob/be4a12c3f861c31f2be3c0f81809cfc5ab6bb5fd/src/ui/AutoCompleteSuggest.ts#L595-L619
            const item = this.suggestions.values[this.suggestions.selectedItem];
            openFileAndSelectPosition(item.file, item.cache.position, ...LEAF_OPTION_TO_ARGS[this.plugin.extraSettings.suggestLeafOption]);
            return false;
        });

        // Shift (by default) + Enter to insert a link to the note containing the selected item
        this.scope.register([this.plugin.extraSettings.modifierToNoteLink], "Enter", () => {
            const item = this.suggestions.values[this.suggestions.selectedItem];
            this.selectSuggestionImpl(item, true);
            return false;
        });

        if (this.plugin.extraSettings.showModifierInstruction) {
            this.setInstructions([
                { command: "↑↓", purpose: "to navigate" },
                { command: "↵", purpose: "to insert link" },
                { command: `${getModifierNameInPlatform(this.plugin.extraSettings.modifierToNoteLink)} + ↵`, purpose: "to insert link to note"},
                { command: `${getModifierNameInPlatform(this.plugin.extraSettings.modifierToJump)} + ↵`, purpose: "to jump"},
            ]);    
        }
    }

    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
        const trigger = this.types.contains("theorem")
            ? (this.types.contains("equation")
                ? (this.plugin.extraSettings.triggerSuggest ?? DEFAULT_EXTRA_SETTINGS.triggerSuggest)
                : (this.plugin.extraSettings.triggerTheoremSuggest ?? DEFAULT_EXTRA_SETTINGS.triggerTheoremSuggest))
            : (this.plugin.extraSettings.triggerEquationSuggest ?? DEFAULT_EXTRA_SETTINGS.triggerEquationSuggest);
        const text = editor.getRange({ line: cursor.line, ch: 0 }, cursor);
        const index = text.lastIndexOf(trigger);
        const query = text.slice(index + trigger.length);
        this.limit = this.plugin.extraSettings.suggestNumber;
        return (index >= 0 && !query.startsWith("[[")) ? {
            start: { line: cursor.line, ch: index },
            end: cursor,
            query
        } : null;
    }

    getSuggestions(context: EditorSuggestContext): IndexItem[] {
        const callback = (this.plugin.extraSettings.searchMethod == "Fuzzy" ? prepareFuzzySearch : prepareSimpleSearch)(context.query);
        const results: { match: SearchResult, item: IndexItem }[] = [];

        const recentFilePaths = this.app.workspace.getLastOpenFiles();

        if (this.plugin.extraSettings.searchOnlyRecent) {
            const recentFiles = recentFilePaths.map((path) => this.app.vault.getAbstractFileByPath(path));
            for (const file of recentFiles) {
                if (file instanceof TFile) {
                    const noteIndex = this.plugin.index.getNoteIndex(file);
                    this.getSuggestionsImpl(noteIndex, results, callback);
                }
            }
        } else {
            for (const noteIndex of this.plugin.index.data.values()) {
                if (noteIndex instanceof NoteIndex) {
                    this.getSuggestionsImpl(noteIndex, results, callback);
                }
            }
        }

        if (!this.plugin.extraSettings.searchOnlyRecent) {
            results.forEach((result) => {
                if (recentFilePaths.contains(result.item.file.path)) {
                    result.match.score += this.plugin.extraSettings.upWeightRecent;
                }
            });
        }

        sortSearchResults(results);
        return results.map((result) => result.item);
    }

    getSuggestionsImpl(noteIndex: NoteIndex, results: { match: SearchResult, item: IndexItem }[], callback: (text: string) => SearchResult | null) {
        for (const which of this.types) {
            for (const item of noteIndex[which as IndexItemType]) {
                const cache = this.app.metadataCache.getFileCache(item.file);
                const tags = cache ? (getAllTags(cache) ?? []) : [];

                let text = `${item.printName} ${item.file.path} ${tags.join(" ")}`;

                if (item.type == "theorem" && item.settings) {
                    const settings = resolveSettings(item.settings, this.plugin, item.file);
                    text += ` ${settings.type} ${formatLabel(settings) ?? ""}`
                } else if (item.type == "equation" && item.mathText) {
                    text += " " + item.mathText;
                }
                const result = callback(text);
                if (result) {
                    results.push({ match: result, item });
                }
            }
        }
    }

    renderSuggestion(item: IndexItem, el: HTMLElement): void {
        const baseEl = el.createDiv({ cls: "math-booster-search-item" });
        if (item.printName) {
            baseEl.createDiv({ text: item.printName });
        }
        const smallEl = baseEl.createEl(
            "small", {
            text: `${item.file.path.slice(0, - item.file.extension.length - 1)}, line ${item.cache.position.start.line + 1}`,
            cls: "math-booster-search-item-description"
        });
        if (item.type == "equation" && item.mathText) {
            if (this.plugin.extraSettings.renderMathInSuggestion) {
                const mjxContainerEl = renderMath(item.mathText, true);
                baseEl.insertBefore(mjxContainerEl, smallEl);
                finishRenderMath();
            } else {
                const mathTextEl = createDiv({ text: item.mathText });
                baseEl.insertBefore(mathTextEl, smallEl);
            }
        }
    }

    selectSuggestion(item: IndexItem, evt: MouseEvent | KeyboardEvent): void {
        this.selectSuggestionImpl(item, false);
    }

    async selectSuggestionImpl(item: IndexItem, insertNoteLink: boolean): Promise<void> {
        const cache = this.app.metadataCache.getFileCache(item.file);
        if (this.context && cache) {
            const { editor, start, end, file } = this.context;
            const settings = resolveSettings(undefined, this.plugin, file);
            const secType = item.type == "theorem" ? "callout" : "math";

            const sec = findSectionCache(
                cache,
                (sec) => sec.type == secType && sec.position.start.line == item.cache.position.start.line
            );

            let success = false;

            if (sec) {
                const result = await insertBlockIdIfNotExist(this.plugin, item.file, cache, sec);
                if (result) {
                    const { id, lineAdded } = result;
                    // We can't use FileManager.generateMarkdownLink here.
                    // This is because, when the user is turning off "Use [[Wikilinks]]", 
                    // FileManager.generateMarkdownLink inserts a markdown link [](), not a wikilink [[]].
                    // Markdown links are hard to deal with for the purpose of this plugin, and also
                    // MathLinks has some issues with markdown links (https://github.com/zhaoshenzhai/obsidian-mathlinks/issues/47).
                    // So we have to explicitly generate a wikilink here.
                    let linktext = ""; 
                    if (item.file != file) {
                        linktext += this.app.metadataCache.fileToLinktext(item.file, file.path);   
                    }
                    if (!insertNoteLink) {
                        linktext += `#^${id}`;
                    }
                    const link = `[[${linktext}]]`
                    const insertText = link + (settings.insertSpace ? " " : "");
                    if (item.file == file) {
                        editor.replaceRange(
                            insertText,
                            { line: start.line + lineAdded, ch: start.ch },
                            { line: end.line + lineAdded, ch: end.ch }
                        );
                    } else {
                        editor.replaceRange(insertText, start, end);
                    }
                    success = true;
                }
            }
            if (!success) {
                new Notice(`${this.plugin.manifest.name}: Failed to read cache. Retry again later.`, 5000);
            }
        }
    }
}
