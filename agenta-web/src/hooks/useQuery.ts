import { NextRouter, useRouter } from "next/router";
import { ParsedUrlQuery, parse } from "querystring";

type Method = "push" | "replace";

function getUpdateQuery(router: NextRouter, method: Method) {
	return (queryObj: ParsedUrlQuery) => {
		const query = parse(window.location.search.replace("?", ""));
		const newQuery = {
			...query,
			...queryObj,
		};
		//delete keys with undefined values
		Object.keys(newQuery).forEach((key) => {
			if (newQuery[key] === undefined) {
				delete newQuery[key];
			}
		});

		router[method]({
			pathname: router.pathname,
			query: newQuery,
		});
	};
}

export function useQuery(
	method: Method = "push"
): [ParsedUrlQuery, (query: ParsedUrlQuery) => void] {
	const router = useRouter();
	const { query } = router;

	return [query, getUpdateQuery(router, method)];
}

export function useQueryParam(
	paramName: string,
	defaultValue?: string,
	method?: Method
): [string, (val: string) => void] {
	const [query, updateQuery] = useQuery(method);
	const value = (query as Record<string, any>)[paramName] || defaultValue;

	const setValue = (val: string) => {
		updateQuery({ [paramName]: val });
	};

	return [value, setValue];
}
