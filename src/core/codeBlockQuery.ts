import { HeatmapColorModes, HeatmapConfig } from "@/defs/types";
import jsep from "jsep";
import { DailyActivity } from "@/db/types";

type JsepExpression = jsep.Expression;
import {
	isValidCalculationType,
	isValidTargetCount,
	isValidUnit,
	isValidColoringMode,
} from "@/utils/utils";
import { SlotConfig, Unit, CalculationType, TargetCount } from "@/defs/types";
import { state } from "./pluginState";

const filterOperators = new Set([
	"starts_with",
	"STARTS_WITH",
	"contains",
	"CONTAINS",
	"&&",
	"||",
	"==",
	"!=",
	">",
	"<",
	">=",
	"<=",
]);
for (const operator of ["starts_with", "STARTS_WITH", "contains", "CONTAINS"]) {
	jsep.addBinaryOp(operator, 6);
}

const heatmapOptions = new Set([
	"OPTIONS",
	"HIDE",
	"COLORING_MODE",
	"STOPS",
	"SQUARED_CELLS",
	"START_DATE",
	"ROUNDED_CELLS",
	"CENTER",
	"WEEKS",
	"UNIT",
]);

function parseUnit(value: string): Unit | undefined {
	const normalized =
		value === "WORDS" ? "WORD" : value === "CHARS" ? "CHAR" : value;
	return isValidUnit(normalized) ? normalized : undefined;
}

export function parseSlotsCodeBlock(source: string) {
	const { filterText, optionsText } = splitFilterAndOptions(source);
	// Slots also count current files, for which only the path is available.
	const filter = parseFilter(filterText, ["filePath"]);
	return { filter, slots: parseSlotQuery(optionsText) };
}

export function parseSlotQuery(query: string): SlotConfig[] {
	const arrayOfLines = query
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	if (arrayOfLines.length === 0) return [];

	const slots: SlotConfig[] = [];

	for (let i = 0; i < arrayOfLines.length; i++) {
		const parts = arrayOfLines[i].split(",").map((part) => part.trim());

		const type = parts[0];
		let unit = state.plugin.data.settings.preferredUnit ?? Unit.WORD;
		let calc = CalculationType.TOTAL;

		if (!isValidTargetCount(type)) {
			throw new Error(`Unknown slot: ${type}.`);
		}

		if (parts[1]) {
			const parsedUnit = parseUnit(parts[1]);
			if (!parsedUnit)
				throw new Error(
					`Unknown unit: ${parts[1]}. Use WORDS or CHARS.`,
				);
			unit = parsedUnit;
		}
		if (parts[2]) {
			if (!isValidCalculationType(parts[2])) {
				throw new Error(
					`Unknown calculation: ${parts[2]}. Use TOTAL or AVG.`,
				);
			}
			calc = parts[2];
		}
		if (parts.length > 3)
			throw new Error(
				`Too many values for ${type}. Use SLOT, UNIT, CALCULATION.`,
			);

		slots.push({
			index: i,
			option: type,
			unit: unit,
			calc: calc ?? CalculationType.TOTAL,
		});
	}

	return slots;
}

export function parseQueryToJSEP(query: string) {
	const { filterText, optionsText } = splitFilterAndOptions(query);
	const parsed = parseFilter(filterText);
	const config: HeatmapConfig = structuredClone(
		state.plugin.data.settings.heatmapConfig,
	);
	config.hideMonthLabels = false;
	config.hideWeekdayLabels = false;

	if (optionsText) {
		const arrayOfLines = optionsText.match(/[^\r\n]+/g);
		if (arrayOfLines && arrayOfLines.length >= 1) {
			/** defaults to user settings to define heatmapconfig */

			for (let i = 0; i < arrayOfLines.length; i++) {
				const line = arrayOfLines[i].split("//")[0].trim();
				if (!line) continue;
				const slotName = line.split(/[\s,]/)[0];
				if (isValidTargetCount(slotName)) {
					throw new Error(
						`${slotName} belongs in a ktr-slots block. Heatmaps accept a filter and display options such as WEEKS.`,
					);
				}
				const keyword = line.split(/\s/)[0];
				const details = line.slice(keyword.length).trim();

				switch (keyword) {
					case "OPTIONS":
						break;
					case "HIDE":
						if (details) {
							const items = details.replace(/ /g, "").split(",");
							for (let j = 0; j < items.length; j++) {
								switch (items[j]) {
									case "month_labels":
										config.hideMonthLabels = true;
										break;
									case "weekday_labels":
										config.hideWeekdayLabels = true;
										break;
								}
							}
						}
						break;
					case "COLORING_MODE":
						if (details && isValidColoringMode(details.trim())) {
							config.intensityMode =
								details.trim() as HeatmapColorModes;
						}
						break;
					case "STOPS":
						if (details) {
							const stops = details.replace(/ /g, "").split(",");
							if (stops.length == 1) {
								config.intensityStops.high = Number(stops[0]);
							} else if (stops.length == 2) {
								config.intensityStops.low = Number(stops[0]);
								config.intensityStops.high = Number(stops[1]);
							} else if (stops.length == 3) {
								config.intensityStops.low = Number(stops[0]);
								config.intensityStops.medium = Number(stops[1]);
								config.intensityStops.high = Number(stops[2]);
							}
						}
						break;
					case "SQUARED_CELLS":
						config.roundCells = false;
						break;
					case "START_DATE":
						config.startDate = details;
						break;
					case "ROUNDED_CELLS":
						config.roundCells = true;
						break;
					case "CENTER":
						config.center = true;
						break;
					case "WEEKS":
						config.numberOfWeeks = Number(details) || 20;
						break;
					case "UNIT":
						config.unit = parseUnit(details.trim());
						if (!config.unit)
							throw new Error(
								`Unknown unit: ${details}. Use WORDS or CHARS.`,
							);
						break;
					default:
						throw new Error(`Unknown heatmap option: ${keyword}.`);
				}
			}
		}
	}

	return {
		filter: parsed,
		options: config,
	};
}

function normalizeLogicalOperators(input: string): string {
	// Preserve words such as "OR" inside quoted folder names.
	return input.replace(
		/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:AND|OR)\b/gi,
		(token) =>
			/^(AND|OR)$/i.test(token)
				? token.toUpperCase() === "AND"
					? "&&"
					: "||"
				: token,
	);
}

function parseFilter(
	text: string,
	fields = ["filePath", "date", "id", "wordCountStart", "charCountStart"],
) {
	if (!text.trim()) return undefined;
	try {
		const node = jsep(normalizeLogicalOperators(text));
		validateFilter(node, fields);
		return node;
	} catch (error) {
		throw new Error(
			`Invalid filter: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function validateFilter(node: JsepExpression, fields: string[]): void {
	switch (node.type) {
		case "Literal":
			return;
		case "Identifier": {
			const { name } = node as jsep.Identifier;
			if (!fields.includes(name))
				throw new Error(
					`Unknown filter field: ${name}. Allowed fields: ${fields.join(", ")}.`,
				);
			return;
		}
		case "BinaryExpression": {
			const { operator, left, right } = node as jsep.BinaryExpression;
			if (!filterOperators.has(operator))
				throw new Error(`Unsupported operator: ${operator}.`);
			validateFilter(left, fields);
			validateFilter(right, fields);
			return;
		}
		case "UnaryExpression": {
			const { operator, argument } = node as jsep.UnaryExpression;
			if (operator !== "!")
				throw new Error(`Unsupported operator: ${operator}.`);
			validateFilter(argument, fields);
			return;
		}
		default:
			throw new Error(
				"Expected one filter expression. Join conditions with AND or OR.",
			);
	}
}

export function compileEvaluator(
	node: JsepExpression | null | undefined,
): (entry: Partial<DailyActivity>) => boolean {
	if (!node) {
		return () => true;
	}

	return (entry: Partial<DailyActivity>) => {
		try {
			return Boolean(interpretNode(node, entry));
		} catch (error) {
			console.error("Filter evaluation error:", error);
			return false;
		}
	};
}

function splitFilterAndOptions(input: string) {
	const lines = input.split("\n");

	const filterLines: string[] = [];
	const optionsLines: string[] = [];

	let inOptions = false;

	for (const line of lines) {
		const trimmedLine = line.trim();

		// Skip empty lines
		if (!trimmedLine) {
			if (inOptions) {
				optionsLines.push(line);
			} else {
				filterLines.push(line);
			}
			continue;
		}

		// Recognize actual options, including comma-separated slots. AND/OR
		// on a new line must remain part of the filter expression.
		const keyword = trimmedLine.split(/[\s,]/)[0];
		if (
			!inOptions &&
			(heatmapOptions.has(keyword) ||
				Object.values(TargetCount).includes(keyword as TargetCount))
		) {
			inOptions = true;
		}

		if (inOptions) {
			optionsLines.push(line);
		} else {
			filterLines.push(line);
		}
	}

	return {
		filterText: filterLines.join("\n").trim(),
		optionsText: optionsLines.join("\n").trim(),
	};
}

function interpretNode(
	node: JsepExpression,
	entry: Partial<DailyActivity>,
): unknown {
	if (!node) return true;

	switch (node.type) {
		case "Literal": {
			let value = node.value;
			if (typeof value === "string") {
				value = value.startsWith("/") ? value.substring(1) : value;
			}
			return value;
		}
		case "Identifier": {
			return entry &&
				entry[node.name as keyof DailyActivity] !== undefined
				? entry[node.name as keyof DailyActivity]
				: "";
		}
		case "BinaryExpression": {
			const left = interpretNode(node.left as JsepExpression, entry);
			const right = interpretNode(node.right as JsepExpression, entry);
			const operator =
				typeof node.operator === "string" ? node.operator : "unknown";

			switch (operator) {
				case "&&":
					return left && right;
				case "||":
					return left || right;
				case "starts_with":
				case "STARTS_WITH":
					return String(left).startsWith(String(right));
				case "contains":
				case "CONTAINS":
					return String(left).includes(String(right));
				case "==":
					return left === right;
				case "!=":
					return left !== right;
				case ">":
					return Number(left) > Number(right);
				case "<":
					return Number(left) < Number(right);
				case ">=":
					return Number(left) >= Number(right);
				case "<=":
					return Number(left) <= Number(right);
				default:
					throw new Error(`Unsupported operator: ${operator}`);
			}
		}
		case "UnaryExpression": {
			const argument = interpretNode(
				node.argument as JsepExpression,
				entry,
			);
			const operator =
				typeof node.operator === "string" ? node.operator : "unknown";
			switch (operator) {
				case "!":
					return !argument;
				default:
					throw new Error(`Unsupported unary operator: ${operator}`);
			}
		}
		default:
			throw new Error(`Unsupported node type: ${node.type}`);
	}
}
