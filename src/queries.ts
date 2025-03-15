export interface QueryCondition {
	target: string;
	targetType: string;
	inclusion: boolean;
	isAnd: boolean;
}

enum QueryTargetTypes {
	path = "PATH",
	prop = "PROPERTY",
	title = "TITLE",
}

// function handlePathQuery() {

// }

function handlePropQuery() {}

function handleTitleQuery() {}

export function parseQuery(query: string): QueryCondition[] {
	// const queryWords = query.split(/\s+/);
	// const conditions: QueryCondition[] = [];
	const conditions = query.split("\n");
	const returnConditions: QueryCondition[] = [];
	for (let i = 0; i < conditions.length; i++) {
		let conditionArray = conditions[i].split(" ");
		let condition: QueryCondition = {
			targetType: conditionArray[0],
			inclusion: true,
			target: "",
			isAnd: false,
		};

		switch (conditionArray[0]) {
			case "PATH":
				if (conditionArray[1] == "includes") {
					condition.inclusion = true;
				} else if (conditionArray[1] == "does") {
					condition.inclusion = false;
				}
				condition.target = conditions[i].match(/"([^"]*)"/)?.[1] || "";
			// TODO: add support for AND queries
			// if (conditions[i].includes("AND")) {
			// 	condition.isAnd = true;
			// }
			// case "PROP":
			// const propcondition = conditions[i].split(/[==;!=]/);
			// console.log(propcondition);
			// case "TITLE":
			// handle title
		}

		returnConditions.push(condition);
	}
	return returnConditions;
	// const conditions = query.split(/(?=[PATH])/);
	// for (let i = 0; i < queryWords.length; i++) {
	// 	let condition: QueryCondition = {
	// 		targetType: "",
	// 		targets: [],
	// 		inclusion: true,
	// 	};

	// 	const targetType = queryWords[i];
	// 	console.log("target type is " + targetType);

	// 	if (Object.values<string>(QueryTargetTypes).includes(targetType)) {
	// 		condition.targetType = targetType;
	// 	} else {
	// 		console.error("Error: Unknown query type");
	// 	}

	// 	i++;

	// 	const conditionType = queryWords[i];

	// 	switch (condition.targetType) {
	// 		case "PATH":
	// 			if (conditionType == "includes") {
	// 				condition.inclusion = true;
	// 				i++;
	// 				if (i >= queryWords.length) {
	// 					return conditions;
	// 				}
	// 			} else if (conditionType == "does") {
	// 				condition.inclusion = false;
	// 				i += 3;
	// 				if (i >= queryWords.length) {
	// 					return conditions;
	// 				}
	// 			} else {
	// 				console.error("Error: could not parse query.");
	// 			}
	// 	}

	// 	// let conditionTarget = queryWords[i].replace(/\"|'/g, "");
	// 	condition.targets.push(conditionTarget);

	// 	conditions.push(condition);

	// if (Object.keys(QueryTargetTypes).includes(word)) {
	// 	console.log("---");
	// 	console.log(word);
	// }
	// check if is a type
	// check if is a target
	// check if its a verb
	// check if its a and/or
	// }

	// const queryLines = query.split("\n");
	// for (let i = 0; i < queryLines.length; i++) {
	// 	// let condition: QueryCondition = {
	// 	// 	target: "",
	// 	// 	targetType: getQueryTargetType(queryLines[i]),
	// 	// };
	// }
}

// function getQueryTarget(query: string): string {
// 	return "";
// }
// function getQueryTargetType(query: string): string {
// 	const regex = /^([\w\-]+)/;
// 	const match = regex.exec(query);
// 	if (match) {
// 		return match[0];
// 	} else {
// 		return "";
// 	}
// }
// TARGET TYPES:
// PATHS, PROPERTIES, FILENAME, DATES (?)

// includes
// does not include
// ==
// !=

// ACTIONS
// includes, does not include

// ==, !=

// PROP (isArchived == true) AND
// PATH (includes "testando") OR

// PATH includes
// PATH includes
// export function parsePathFilters(query: string): PathCondition[] {
// 	const conditions: PathCondition[] = [];

// 	const regex = /PATH\s+((?:does\s+not\s+include)|includes)\s+"([^"]+)"/gi;
// 	let match;
// 	while ((match = regex.exec(query)) !== null) {
// 		const isInclusion = match[1].toLowerCase() !== "does not include";
// 		conditions.push({
// 			path: match[2],
// 			isInclusion,
// 		});
// 	}
// 	return conditions;
// }
