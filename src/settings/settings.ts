import { ENV_IDs } from "../env";
import { DEFAULT_LANG } from "../default_lang";


export const NUMBER_STYLES = [
    "arabic",
    "alph",
    "Alph",
    "roman",
    "Roman"
] as const;
export type NumberStyle = typeof NUMBER_STYLES[number];

export type RenameEnv = { [K in typeof ENV_IDs[number]]: string };

export const MATH_CALLOUT_STYLES = [
    "custom", 
    "plain",
    "framed",
    "mathwiki",
    "vivid",
] as const;
export type MathCalloutStyle = typeof MATH_CALLOUT_STYLES[number];

export const MATH_CALLOUT_REF_FORMATS = [
    "Type + number (+ title)", 
    "Type + number", 
    "Only title if exists, type + number otherwise"
] as const;
export type MathCalloutRefFormat = typeof MATH_CALLOUT_REF_FORMATS[number];

/**
 * Set a specific math callout to be "main" of the note.
 * Used to automatically set "setAsNoteMathLink" of each math callout.
 * 
 * - None: Do not set a main math callout.
 * - First: Set the first math callout of the note as main.
 * - Last: Set the last math callout of the note as main.
 */
export const MAIN_MATH_CALLOUT_SPECIFIERS = [
    "None",
    "First", 
    "Last",
] as const;
export type MainMathCalloutSpecifier = typeof MAIN_MATH_CALLOUT_SPECIFIERS[number];

export interface MathContextSettings {
    lang: string;
    titleSuffix: string;
    numberPrefix: string;
    numberSuffix: string;
    numberInit: number;
    numberStyle: NumberStyle;
    numberDefault: string;
    refFormat: MathCalloutRefFormat;
    noteMathLinkFormat: MathCalloutRefFormat;
    eqNumberPrefix: string;
    eqNumberSuffix: string;
    eqNumberInit: number;
    eqNumberStyle: NumberStyle;
    eqRefPrefix: string;
    eqRefSuffix: string;
    labelPrefix: string;
    rename: RenameEnv;
    lineByLine: boolean;
    mathCalloutStyle: MathCalloutStyle;
    mathCalloutFontInherit: boolean;
    mainMathCallout: MainMathCalloutSpecifier;
}

export interface MathCalloutSettings {
    type: string;
    number: string;
    title?: string;
    label?: string;
    setAsNoteMathLink: boolean;
}

export interface MathCalloutPrivateFields {
    _index?: number;
}

export interface ExtraSettings {
    noteTitleInLink: boolean;
}

export type MathSettings = Partial<MathContextSettings> & MathCalloutSettings & MathCalloutPrivateFields;
export type ResolvedMathSettings = Required<MathContextSettings> & MathCalloutSettings & MathCalloutPrivateFields;

export const DEFAULT_SETTINGS: Required<MathContextSettings> = {
    lang: DEFAULT_LANG,
    titleSuffix: ".",
    numberPrefix: "",
    numberSuffix: "",
    numberInit: 1,
    numberStyle: "arabic",
    numberDefault: "auto", 
    refFormat: "Type + number (+ title)",
    noteMathLinkFormat: "Type + number (+ title)",
    eqNumberPrefix: "",
    eqNumberSuffix: "",
    eqNumberInit: 1,
    eqNumberStyle: "arabic",
    eqRefPrefix: "", 
    eqRefSuffix: "",
    labelPrefix: "",
    rename: {} as RenameEnv,
    lineByLine: true,
    mathCalloutStyle: "framed",
    mathCalloutFontInherit: false,
    mainMathCallout: "None",
}

export const DEFAULT_EXTRA_SETTINGS: Required<ExtraSettings> = {
    noteTitleInLink: true,
};
