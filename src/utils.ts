import { Modifier, Platform } from 'obsidian';
import { renderMath, finishRenderMath, TAbstractFile, TFolder, EditorPosition, Loc, CachedMetadata, SectionCache, parseLinktext, resolveSubpath, Notice, TFile, editorLivePreviewField, MarkdownView, Component, MarkdownRenderer, LinkCache, BlockCache, App, Pos, Plugin } from 'obsidian';
import { DataviewApi, getAPI } from 'obsidian-dataview';
import { EditorState, ChangeSet, RangeValue, RangeSet } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { SyntaxNodeRef } from '@lezer/common';

import MathBooster from './main';
import { DEFAULT_SETTINGS, TheoremCalloutPrivateFields, TheoremCalloutSettings, MathContextSettings, NumberStyle, ResolvedMathSettings } from './settings/settings';
import { MathInfoSet } from './math_live_preview_in_callouts';
import { THEOREM_LIKE_ENVs, TheoremLikeEnvID } from './env';
import { Backlink } from './backlinks';
import { getIO } from './file_io';
import { LeafArgs } from './type';
import { platform } from 'os';


const ROMAN = ["", "C", "CC", "CCC", "CD", "D", "DC", "DCC", "DCCC", "CM",
    "", "X", "XX", "XXX", "XL", "L", "LX", "LXX", "LXXX", "XC",
    "", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];

export function toRomanUpper(num: number): string {
    // https://stackoverflow.com/a/9083076/13613783
    const digits = String(num).split("");
    let roman = "";
    let i = 3;
    while (i--) {
        // @ts-ignore
        roman = (ROMAN[+digits.pop() + (i * 10)] ?? "") + roman;
    }
    return Array(+digits.join("") + 1).join("M") + roman;
}

export function toRomanLower(num: number): string {
    return toRomanUpper(num).toLowerCase();
}

export const ALPH = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function toAlphUpper(num: number): string {
    return (num - 1).toString(26).split("").map(str => ALPH[parseInt(str, 26)]).join("");
}

export function toAlphLower(num: number): string {
    return toAlphUpper(num).toLowerCase();
}

export const CONVERTER = {
    "arabic": String,
    "alph": toAlphLower,
    "Alph": toAlphUpper,
    "roman": toRomanLower,
    "Roman": toRomanUpper,
}

export function increaseQuoteLevel(content: string): string {
    let lines = content.split("\n");
    lines = lines.map((line) => "> " + line);
    return lines.join("\n");
}

export async function renderTextWithMath(source: string): Promise<(HTMLElement | string)[]> {
    // Obsidian API's renderMath only can render math itself, but not a text with math in it.
    // e.g., it can handle "\\sqrt{x}", but cannot "$\\sqrt{x}$ is a square root"

    const elements: (HTMLElement | string)[] = [];

    const mathPattern = /\$(.*?[^\s])\$/g;
    let result;
    let textFrom = 0;
    let textTo = 0;
    while ((result = mathPattern.exec(source)) !== null) {
        const mathString = result[1];
        textTo = result.index;
        if (textTo > textFrom) {
            elements.push(source.slice(textFrom, textTo));
        }
        textFrom = mathPattern.lastIndex;

        const mathJaxEl = renderMath(mathString, false);
        await finishRenderMath();

        const mathSpan = createSpan({ cls: ["math", "math-inline", "is-loaded"] });
        mathSpan.replaceChildren(mathJaxEl);
        elements.push(mathSpan);
    }

    if (textFrom < source.length) {
        elements.push(source.slice(textFrom));
    }

    return elements;
}

/**
 * Easy-to-use version of MarkdownRenderer.renderMarkdown.
 * @param markdown 
 * @param sourcePath 
 * @param component - Typically you can just pass the plugin instance. 
 * @returns 
 */
export async function renderMarkdown(markdown: string, sourcePath: string, component: Component): Promise<NodeList | undefined> {
    const el = createSpan();
    await MarkdownRenderer.renderMarkdown(markdown, el, sourcePath, component);
    for (const child of el.children) {
        if (child.tagName == "P") {
            return child.childNodes;
        }
    }
}

export function isEqualToOrChildOf(file1: TAbstractFile, file2: TAbstractFile): boolean {
    if (file1 == file2) {
        return true;
    }
    if (file2 instanceof TFolder && file2.isRoot()) {
        return true;
    }
    let ancestor = file1.parent;
    while (true) {
        if (ancestor == file2) {
            return true;
        }
        if (ancestor) {
            if (ancestor.isRoot()) {
                return false;
            }
            ancestor = ancestor.parent
        }
    }
}

export function locToEditorPosition(loc: Loc): EditorPosition {
    return { ch: loc.col, line: loc.line };
}

export function getMathCache(cache: CachedMetadata, lineStart: number): SectionCache | undefined {
    if (cache.sections) {
        const sectionCache = Object.values(cache.sections).find((sectionCache) =>
            sectionCache.type == 'math'
            && sectionCache.position.start.line == lineStart
        );
        return sectionCache;
    }
}

export function getSectionCacheFromPos(cache: CachedMetadata, pos: number, type: string): SectionCache | undefined {
    // pos: CodeMirror offset units
    if (cache.sections) {
        const sectionCache = Object.values(cache.sections).find((sectionCache) =>
            sectionCache.type == type
            && (sectionCache.position.start.offset == pos || sectionCache.position.end.offset == pos)
        );
        return sectionCache;
    }
}

export function getMathCacheFromPos(cache: CachedMetadata, pos: number): SectionCache | undefined {
    return getSectionCacheFromPos(cache, pos, "math");
}

export function findSectionCache(cache: CachedMetadata, callback: (sectionCache: SectionCache, index: number, sections: SectionCache[]) => boolean): SectionCache | undefined {
    // pos: CodeMirror offset units
    if (cache.sections) {
        return Object.values(cache.sections).find(callback);
    }
}

export function getSectionCacheOfDOM(el: HTMLElement, type: string, view: EditorView, cache: CachedMetadata) {
    const pos = view.posAtDOM(el);
    return getSectionCacheFromPos(cache, pos, type);
}

export function getSectionCacheFromMouseEvent(event: MouseEvent, type: string, view: EditorView, cache: CachedMetadata) {
    const pos = view.posAtCoords(event) ?? view.posAtCoords(event, false);
    return getSectionCacheFromPos(cache, pos, type);
}

export function getBacklinks(app: App, plugin: MathBooster, file: TFile, cache: CachedMetadata, pick: (block: BlockCache) => boolean): Backlink[] | null {
    const backlinksToNote = plugin.oldLinkMap.invMap.get(file.path); // backlinks to the note containing this theorem callout
    const backlinks: Backlink[] = [] // backlinks to this theorem callout
    if (backlinksToNote) {
        for (const backlink of backlinksToNote) {
            const sourceCache = app.metadataCache.getCache(backlink);
            sourceCache?.links
                ?.forEach((link: LinkCache) => {
                    const { subpath } = parseLinktext(link.link);
                    const subpathResult = resolveSubpath(cache, subpath);
                    if (subpathResult?.type == "block" && pick(subpathResult.block)) {
                        backlinks.push({ sourcePath: backlink, link: link });
                    }
                })
        }
    }
    return backlinks;
}

export function generateBlockID(cache: CachedMetadata, length: number = 6): string {
    let id = '';

    while (true) {
        // Reference: https://stackoverflow.com/a/58326357/13613783
        id = [...Array(length)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
        if (cache?.blocks && id in cache.blocks) {
            continue;
        } else {
            break;
        }
    }
    return id;
}

export async function insertBlockIdIfNotExist(plugin: MathBooster, targetFile: TFile, cache: CachedMetadata, sec: SectionCache, length: number = 6): Promise<{ id: string, lineAdded: number } | undefined> {
    // Make sure the section cache is fresh enough!
    if (!(cache?.sections)) return;

    if (sec.id) return { id: sec.id, lineAdded: 0 };

    // The section has no block ID, so let's create a new one
    const id = generateBlockID(cache, length);
    // and insert it
    const io = getIO(plugin, targetFile);
    await io.insertLine(sec.position.end.line + 1, "^" + id);
    await io.insertLine(sec.position.end.line + 1, "")
    return { id, lineAdded: 2 };
}

export function isLivePreview(state: EditorState) {
    return state.field(editorLivePreviewField);
}

export function isSourceMode(state: EditorState) {
    return !isLivePreview(state);
}

export function isReadingView(markdownView: MarkdownView) {
    return markdownView.getMode() == "preview";
}

export function isEditingView(markdownView: MarkdownView) {
    return markdownView.getMode() == "source";
}

export function getMarkdownPreviewViewEl(view: MarkdownView) {
    return Array.from(view.previewMode.containerEl.children).find((child) => child.matches(".markdown-preview-view"));
}

export function getMarkdownSourceViewEl(view: MarkdownView) {
    const firstCandidate = view.editor.cm?.dom.parentElement;
    if (firstCandidate) return firstCandidate;
    const secondCandidate = view.previewMode.containerEl.previousSibling;
    if (secondCandidate instanceof HTMLElement && secondCandidate.matches(".markdown-source-view")) {
        return secondCandidate;
    }
}


/** CodeMirror/Lezer utilities */

export function nodeText(node: SyntaxNodeRef, state: EditorState): string {
    return state.sliceDoc(node.from, node.to);
}

export function printNode(node: SyntaxNodeRef, state: EditorState) {
    // Debugging utility
    console.log(
        `${node.from}-${node.to}: "${nodeText(node, state)}" (${node.name})`
    );
}

export function printMathInfoSet(set: MathInfoSet, state: EditorState) {
    // Debugging utility
    console.log("MathInfoSet:");
    set.between(0, state.doc.length, (from, to, value) => {
        console.log(`  ${from}-${to}: ${value.mathText} ${value.display ? "(display)" : ""} ${value.insideCallout ? "(in callout)" : ""} ${value.overlap === undefined ? "(overlap not checked yet)" : value.overlap ? "(overlapping)" : "(non-overlapping)"}`);
    });
}

export function nodeTextQuoteSymbolTrimmed(node: SyntaxNodeRef, state: EditorState, quoteLevel: number): string | undefined {
    const quoteSymbolPattern = new RegExp(`((>\\s*){${quoteLevel}})(.*)`);
    const quoteSymbolMatch = nodeText(node, state).match(quoteSymbolPattern);
    if (quoteSymbolMatch) {
        return quoteSymbolMatch.slice(-1)[0];
    }
}

export function printChangeSet(changes: ChangeSet) {
    changes.iterChanges(
        (fromA, toA, fromB, toB, inserted) => {
            console.log(`${fromA}-${toA}: "${inserted.toString()}" inserted (${fromB}-${toB} in new state)`);
        }
    );
}

export function rangeSetSome<T extends RangeValue>(set: RangeSet<T>, predicate: (value: T, index: number, set: RangeSet<T>) => unknown) {
    const cursor = set.iter();
    let index = 0;
    while (cursor.value) {
        if (predicate(cursor.value, index, set)) {
            return true;
        }
        cursor.next();
        index++;
    }
    return false;
}

export function getDataviewAPI(plugin: MathBooster): DataviewApi | undefined {
    const dv = getAPI(plugin.app); // Dataview API
    if (dv) {
        return dv;
    }
    new Notice(`${plugin.manifest.name}: Cannot load Dataview API. Make sure that Dataview is installed & enabled.`);
}

export function getBlockIdsWithBacklink(file: TFile, plugin: MathBooster): string[] {
    const dv = getDataviewAPI(plugin);
    const cache = plugin.app.metadataCache.getFileCache(file);
    const ids: string[] = [];
    if (dv && cache) {
        const page = dv.page(file.path); // Dataview page object
        if (page) {
            for (const inlink of page.file.inlinks) {
                // cache of the source of this link (source --link--> target)
                const sourcePath = inlink.path;
                const sourceCache = plugin.app.metadataCache.getCache(sourcePath);
                if (sourceCache) {
                    sourceCache.links?.forEach(
                        (item) => {
                            const linktext = item.link;
                            const parseResult = parseLinktext(linktext);
                            const linkpath = parseResult.path;
                            const subpath = parseResult.subpath;
                            const targetFile = plugin.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
                            if (targetFile && targetFile.path == file.path) {
                                const subpathResult = resolveSubpath(cache as CachedMetadata, subpath);
                                if (subpathResult && subpathResult.type == "block") {
                                    const blockCache = subpathResult.block;
                                    ids.push(blockCache.id);
                                }
                            }
                        }
                    )

                }
            }
        }
    }
    return ids;
}

export function splitIntoLines(text: string): string[] {
    // https://stackoverflow.com/a/5035005/13613783
    return text.split(/\r?\n/);
}

export function removeFrom<Type>(item: Type, array: Array<Type>) {
    return array.splice(array.indexOf(item), 1);
}

export function insertAt<Type>(array: Array<Type>, item: Type, index: number) {
    array.splice(index, 0, item);
}

export const THEOREM_CALLOUT_PATTERN = /\> *\[\! *math *\|(.*?)\](.*)/;

export function matchTheoremCallout(line: string): RegExpExecArray | null {
    if (line) {
        return THEOREM_CALLOUT_PATTERN.exec(line)
    }
    return null;
}

export function readTheoremCalloutSettingsAndTitle(line: string): { settings: TheoremCalloutSettings & TheoremCalloutPrivateFields, title: string } | undefined {
    const matchResult = matchTheoremCallout(line);
    if (matchResult) {
        const settings = JSON.parse(matchResult[1]) as TheoremCalloutSettings;
        const title = matchResult[2].trim();
        return { settings, title };
    }
}

export function readTheoremCalloutSettings(line: string): TheoremCalloutSettings & TheoremCalloutPrivateFields | undefined {
    const result = readTheoremCalloutSettingsAndTitle(line);
    if (result) {
        return result.settings;
    }
}

export function readTheoremCalloutTitle(line: string): string | undefined {
    const result = readTheoremCalloutSettingsAndTitle(line);
    if (result) {
        return result.title;
    }
}

export function pathToName(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
}

export function pathToBaseName(path: string): string {
    const name = pathToName(path);
    const index = name.lastIndexOf('.');
    if (index >= 0) {
        return name.slice(0, index);
    }
    return name;
}

export function iterDescendantFiles(file: TAbstractFile, callback: (descendantFile: TFile) => any, extension?: string) {
    if (file instanceof TFile && (extension === undefined ? true : file.extension == extension)) {
        callback(file);
    } else if (file instanceof TFolder) {
        for (const child of file.children) {
            iterDescendantFiles(child, callback, extension);
        }
    }
}

export function getAncestors(file: TAbstractFile): TAbstractFile[] {
    const ancestors: TAbstractFile[] = [];
    let ancestor: TAbstractFile | null = file;
    while (ancestor) {
        ancestors.push(ancestor);
        if (file instanceof TFolder && file.isRoot()) {
            break;
        }
        ancestor = ancestor.parent;
    }
    ancestors.reverse();
    return ancestors;
}

export function resolveSettings(settings: TheoremCalloutSettings, plugin: MathBooster, currentFile: TAbstractFile): ResolvedMathSettings;
export function resolveSettings(settings: undefined, plugin: MathBooster, currentFile: TAbstractFile): Required<MathContextSettings>;

export function resolveSettings(settings: TheoremCalloutSettings | undefined, plugin: MathBooster, currentFile: TAbstractFile): Required<MathContextSettings> {
    /** Resolves settings. Does not overwride, but returns a new settings object.
     * Returned settings can be either 
     * - ResolvedMathContextSettings or 
     * - Required<MathContextSettings> & Partial<TheoremCalloutSettings>.
     * */
    const resolvedSettings = Object.assign({}, DEFAULT_SETTINGS);
    const ancestors = getAncestors(currentFile);
    for (const ancestor of ancestors) {
        Object.assign(resolvedSettings, plugin.settings[ancestor.path]);
    }
    Object.assign(resolvedSettings, settings);
    return resolvedSettings;
}

export function getProfile(plugin: MathBooster, file: TFile) {
    const settings = resolveSettings(undefined, plugin, file);
    const profile = plugin.extraSettings.profiles[settings.profile];
    return profile;
}

export function getProfileByID(plugin: MathBooster, profileID: string) {
    const profile = plugin.extraSettings.profiles[profileID];
    return profile;
}

export function formatTheoremCalloutType(plugin: MathBooster, settings: { type: string, profile: string }): string {
    const profile = plugin.extraSettings.profiles[settings.profile];
    return profile.body.theorem[settings.type as TheoremLikeEnvID];
}

export function formatTitleWithoutSubtitle(plugin: MathBooster, file: TFile, settings: ResolvedMathSettings): string {
    let title = formatTheoremCalloutType(plugin, settings);

    if (settings.number) {
        if (settings.number == 'auto') {
            if (settings._index !== undefined) {
                settings.numberInit = settings.numberInit ?? 1;
                const num = +settings._index + +settings.numberInit;
                const style = settings.numberStyle ?? DEFAULT_SETTINGS.numberStyle as NumberStyle;
                title += ` ${getNumberPrefix(plugin.app, file, settings)}${CONVERTER[style](num)}${settings.numberSuffix}`;
            }
        } else {
            title += ` ${settings.number}`;
        }
    }
    return title;
}

export function formatTitle(plugin: MathBooster, file: TFile, settings: ResolvedMathSettings, noTitleSuffix: boolean = false): string {
    let title = formatTitleWithoutSubtitle(plugin, file, settings);
    if (settings.title) {
        title += ` (${settings.title})`;
    }
    if (!noTitleSuffix && settings.titleSuffix) {
        title += settings.titleSuffix;
    }
    return title;
}

export function getProperty(app: App, file: TFile, name: string) {
    return app.metadataCache.getFileCache(file)?.frontmatter?.[name];
}

export function getPropertyLink(app: App, file: TFile, name: string) {
    const cache = app.metadataCache.getFileCache(file);
    if (cache?.frontmatterLinks) {
        for (const link of cache.frontmatterLinks) {
            if (link.key == name) {
                return link;
            }
        }    
    }   
}

export function getPropertyOrLinkTextInProperty(app: App, file: TFile, name: string) {
    return getPropertyLink(app, file, name)?.link ?? getProperty(app, file, name);
}


export function inferNumberPrefix(source: string, parseSep: string, printSep: string, useFirstN: number): string | undefined {
    // ex) If filename == "1-2.A foo", then head == "1-2.A"
    const head = source.slice(0, source.match(/\s/)?.index ?? source.length);
    // ex) If parseSep = '.-', then labels == ["1", "2", "A"]
    const labels = head.split(new RegExp(`[${parseSep}]`));
    if (areValidLabels(labels)) {
        // ex) If useFirstN == 1, then usedLabels == ["1"]
        const usedLabels = labels.slice(0, useFirstN);
        let prefix = usedLabels.join(printSep);
        if (!prefix.endsWith(printSep)) {
            prefix += printSep;
        }
        // ex) If printSep == ".", then prefix == "1."
        return prefix;
    }
}

/**
 * "A note about calculus" => The "A" at the head shouldn't be used as a prefix (indefinite article)
 * "A. note about calculus" => The "A" at the head IS a prefix
 */
export function areValidLabels(labels: string[]): boolean {
    function isValidLabel(label: string): boolean { // true if every label is an arabic or roman numeral
        if (label.match(/^[0-9]+$/)) {
            // Arabic numerals
            return true;
        }
        if (label.match(/^M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/i)) {
            // Roman numerals
            // Reference: https://stackoverflow.com/a/267405/13613783
            return true;
        }
        if (label.match(/^[a-z]$/i)) {
            return true;
        }
        return false;
    }
    const blankRemoved = labels.filter((label) => label);
    if (blankRemoved.length >= 2) {
        return blankRemoved.every((label) => isValidLabel(label));
    }
    if (blankRemoved.length == 1) {
        return labels.length == 2 && (isValidLabel(labels[0]));
    }
    return false;
}

/**
 * Get an appropriate prefix for theorem callout numbering.
 * @param file 
 * @param settings 
 * @returns 
 */
export function getNumberPrefix(app: App, file: TFile, settings: Required<MathContextSettings>): string {
    if (settings.numberPrefix) {
        return settings.numberPrefix;
    }
    const source = settings.inferNumberPrefixFromProperty ? getPropertyOrLinkTextInProperty(app, file, settings.inferNumberPrefixFromProperty) : file.basename;
    if (settings.inferNumberPrefix && source) {
        return inferNumberPrefix(
            source,
            settings.inferNumberPrefixParseSep, 
            settings.inferNumberPrefixPrintSep, 
            settings.inferNumberPrefixUseFirstN
        ) ?? "";
    }
    return "";
}

/**
 * Get an appropriate prefix for equation numbering.
 * @param file 
 * @param settings 
 * @returns 
 */
export function getEqNumberPrefix(app: App, file: TFile, settings: Required<MathContextSettings>): string {
    if (settings.eqNumberPrefix) {
        return settings.eqNumberPrefix;
    }
    const source = settings.inferEqNumberPrefixFromProperty ? getPropertyOrLinkTextInProperty(app, file, settings.inferEqNumberPrefixFromProperty) : file.basename;
    if (settings.inferEqNumberPrefix && source) {
        return inferNumberPrefix(
            source, 
            settings.inferEqNumberPrefixParseSep, 
            settings.inferEqNumberPrefixPrintSep, 
            settings.inferEqNumberPrefixUseFirstN
        ) ?? "";
    }
    return "";
}

export function formatLabel(settings: ResolvedMathSettings): string | undefined {
    if (settings.label) {
        return settings.labelPrefix + THEOREM_LIKE_ENVs[settings.type as TheoremLikeEnvID].prefix + ":" + settings.label;
    }
}

export function staticifyEqNumber(plugin: MathBooster, file: TFile) {
    const index = plugin.index.getNoteIndex(file);
    const io = getIO(plugin, file);
    console.log(io);
    index.equation.forEach((item) => {
        if (item.type == "equation" && item.printName && item.mathText) {
            io.setRange(
                item.cache.position,
                `$$\n${item.mathText} \\tag{${item.printName.slice(1, -1)}}\n$$`
            );
        }
    })
}

export async function openFileAndSelectPosition(file: TFile, position: Pos, ...leafArgs: LeafArgs) {
    const leaf = this.app.workspace.getLeaf(...leafArgs);
    await leaf.openFile(file);
    if (leaf.view instanceof MarkdownView) {
        leaf.view.editor.setSelection(
            locToEditorPosition(position.start),
            locToEditorPosition(position.end)
        );
        const cm = leaf.view.editor.cm;
        if (cm) {
            const lineCenter = Math.floor((position.start.line + position.end.line) / 2);
            const posCenter = cm.state.doc.line(lineCenter).from
            cm.dispatch({
                effects: EditorView.scrollIntoView(posCenter, { y: "center" }),
            });
        }
    }
}

export function hasOverlap(range1: { from: number, to: number }, range2: { from: number, to: number }): boolean {
    return range1.from <= range2.to && range2.from <= range1.to;
}

// compare the version of given plugin and the required version
export function isPluginOlderThan(plugin: Plugin, version: string): boolean {
    return plugin.manifest.version.localeCompare(version, undefined, { numeric: true }) < 0;
}

export function getModifierNameInPlatform(mod: Modifier): string {
    if (mod == "Mod") {
        return Platform.isMacOS || Platform.isIosApp ? "⌘" : "ctrl";
    }
    if (mod == "Shift") {
        return "shift";
    }
    if (mod == "Alt") {
        return Platform.isMacOS || Platform.isIosApp ? "⌥" : "alt";
    }
    if (mod == "Meta") {
        return Platform.isMacOS || Platform.isIosApp ? "⌘" : Platform.isWin ? "win" : "meta";
    }
    return "ctrl";
}

// https://stackoverflow.com/a/50851710/13613783
export type BooleanKeys<T> = { [k in keyof T]: T[k] extends boolean ? k : never }[keyof T];

export type NumberKeys<T> = { [k in keyof T]: T[k] extends number ? k : never }[keyof T];


/** unused legacy utility functions */

// // https://github.com/wei2912/obsidian-latex/blob/e71e2bbf459354f9768ba90c7717114fc5f2b177/main.ts#L21C3-L33C1
// export async function loadPreamble(preamblePath: string) {
//     const preamble = await this.app.vault.adapter.read(preamblePath);

//     if (MathJax.tex2chtml == undefined) {
//         MathJax.startup.ready = () => {
//             MathJax.startup.defaultReady();
//             MathJax.tex2chtml(preamble);
//         };
//     } else {
//         MathJax.tex2chtml(preamble);
//     }
// }


// export function validateLinktext(text: string): string {
//     // "[[Filename#Heading]]" --> "Filename#Heading"
//     const len = text.length;
//     if (text[0] == '[' && text[0] == '[' && text[len - 2] == ']' && text[len - 1] == ']') {
//         return text.slice(2, len - 2);
//     }
//     return text;
// }

// export function linktext2TFile(app: App, linktext: string): TFile {
//     linktext = validateLinktext(linktext);
//     const linkpath = getLinkpath(linktext);
//     const file = app.metadataCache.getFirstLinkpathDest(linkpath, "");
//     if (file) {
//         return file;
//     }
//     throw Error(`Could not resolve path: ${linkpath}`);
// }

// export function getLinksAndEmbedsInFile(app: App, file: TFile): { links: string[] | undefined, embeds: string[] | undefined } {
//     const cache = app.metadataCache.getFileCache(file);
//     if (cache) {
//         const { links, embeds } = cache;
//         let linkStrings;
//         let embedStrings
//         if (links) {
//             linkStrings = links.map((item: LinkCache): string => item.link);
//         }
//         if (embeds) {
//             embedStrings = embeds.map((item: LinkCache): string => item.link);
//         }
//         return { links: linkStrings, embeds: embedStrings };
//     }
//     throw Error(`Could not get cached links in ${file.path}`);
// }

