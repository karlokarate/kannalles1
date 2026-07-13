import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

async function openApp(page: Page) {
	await page.goto("/");
	await expect(page).toHaveTitle(/KH Checker/);
	await expect(
		page.getByRole("heading", { name: "Welches Produkt oder Lebensmittel?" }),
	).toBeVisible();
}

async function ensureGatewayConfigured(page: Page) {
	await page
		.getByRole("button", { name: "Einstellungen", exact: true })
		.click();
	const gatewayInput = page.getByLabel(/Daten-Gateway/);
	await gatewayInput.fill("/");
	await expect(gatewayInput).toHaveValue("/");
	await page.getByRole("button", { name: "Suche" }).click();
}

function apiMeta(sourceUrl: string) {
	return {
		cacheStatus: "network",
		cacheLayer: "none",
		gatewayCacheStatus: "network",
		fetchedAt: new Date().toISOString(),
		sourceUrl,
		backend: "gateway",
		originBackend: "search-index",
		networkAttempted: true,
		durationMs: 1,
		attempts: [],
	};
}

function searchPayload(hits: Array<Record<string, unknown>>) {
	return {
		hits,
		count: hits.length,
		page: 1,
		page_size: 15,
		source: hits.length ? "search-index" : "none",
		query_used: "e2e",
		gateway_attempts: [],
		api_meta: apiMeta("https://index.internal/search"),
	};
}

function productPayload(code: string) {
	return {
		status: "success",
		code,
		product: {
			code,
			product_name_de: "E2E Auswahlriegel",
			brands: "E2E Marke",
			quantity: "2 x 25 g",
			product_quantity: 50,
			product_quantity_unit: "g",
			serving_size: "25 g",
			serving_quantity: 25,
			nutrition_data_per: "100g",
			nutriments: { carbohydrates_100g: 40 },
		},
		gateway_attempts: [],
		api_meta: apiMeta(
			`https://world.openfoodfacts.org/api/v3.6/product/${code}.json`,
		),
	};
}

test("App-Shell, Hauptnavigation und mobile Breite bleiben nutzbar", async ({
	page,
}) => {
	await openApp(page);

	const navigation = page.getByRole("navigation", { name: "Hauptnavigation" });
	await expect(navigation).toBeVisible();
	for (const label of ["Suche", "Verlauf", "Favoriten", "Einstellungen"]) {
		await expect(navigation.getByRole("button", { name: label })).toBeVisible();
	}

	const overflow = await page.evaluate(() => ({
		viewport: document.documentElement.clientWidth,
		content: document.documentElement.scrollWidth,
	}));
	expect(overflow.content).toBeLessThanOrEqual(overflow.viewport + 1);
});

test("deterministische manuelle Berechnung funktioniert vollständig ohne Netzwerk", async ({
	page,
}) => {
	await page.route("https://**", (route) => route.abort());
	await openApp(page);

	await page.getByRole("tab", { name: "Manuell" }).click();
	const manualForm = page.locator("form.manual-form");
	await manualForm.getByLabel("Produkt", { exact: true }).fill("Testbrot");
	await manualForm.getByLabel("Menge", { exact: true }).fill("100");
	await manualForm.getByLabel("Einheit", { exact: true }).selectOption("g");
	await page.getByText("Optionale genaue Angaben").click();
	await page.getByLabel("Kohlenhydrate pro 100 Gramm").fill("40");
	await page.getByRole("button", { name: "Berechnen" }).click();

	await expect(page.getByRole("heading", { name: "Ergebnis" })).toBeVisible();
	await expect(page.getByText("Testbrot", { exact: true })).toBeVisible();
	await expect(page.locator(".big-result")).toContainText(/^40\s*g$/);
	await expect(page.getByRole("note")).toContainText(
		"Datenquelle: eigene Eingabe beziehungsweise Etikettwert",
	);
});

test("lokale BLS-Referenz ist ohne Netzwerk nutzbar und quellenrichtig attribuiert", async ({
	page,
}) => {
	await page.route("https://**", (route) => route.abort());
	await openApp(page);
	await page
		.getByLabel("Produkt oder Lebensmittel suchen")
		.fill("100 g Nudeln gekocht");
	await page.getByRole("button", { name: "Suchen" }).click();
	await expect(page.getByRole("heading", { name: "Ergebnis" })).toBeVisible();
	await expect(page.getByRole("note")).toContainText(
		"Generische Referenz: Bundeslebensmittelschlüssel BLS 4.0",
	);
	await expect(page.getByRole("note")).toContainText("Max Rubner-Institut 2025");
});

test("Suchbutton erlaubt sofortige Wiederholung ohne direkten Browser-OFF-Aufruf", async ({
	page,
}) => {
	let gatewayRequests = 0;
	let offRequests = 0;

	page.on("request", (request) => {
		const url = request.url();
		if (url.includes("/api/v1/search")) gatewayRequests += 1;
		if (url.includes("openfoodfacts.org")) offRequests += 1;
	});

	await page.route("**/api/v1/search*", async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 2_000));
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				hits: [],
				count: 0,
				source: "gateway",
				api_meta: {
					cacheStatus: "network",
					fetchedAt: new Date().toISOString(),
					sourceUrl: "/api/v1/search",
					backend: "gateway",
					originBackend: "gateway",
					networkAttempted: true,
					durationMs: 1,
					attempts: [],
				},
			}),
		});
	});

	await openApp(page);
	await ensureGatewayConfigured(page);
	await page
		.getByLabel("Produkt oder Lebensmittel suchen")
		.fill("Kinder Bueno Qualitaetstest");
	await page.getByRole("button", { name: "Suchen" }).click();

	const searchButton = page.getByRole("button", {
		name: /Suchen|Suche neu starten/,
	});
	await expect(searchButton).toBeVisible();
	await expect(searchButton).toBeEnabled();
	await searchButton.click();
	await expect(searchButton).toBeEnabled();
	await expect
		.poll(() => gatewayRequests, { timeout: 12_000 })
		.toBeGreaterThanOrEqual(1);
	expect(offRequests).toBe(0);
});

test("Ausfall beider direkten Suchdienste wird fokussiert und diagnostizierbar erklärt", async ({
	page,
}) => {
	await page.route("https://search.openfoodfacts.org/**", (route) => route.abort());
	await page.route("https://world.openfoodfacts.org/**", (route) => route.abort());
	await openApp(page);
	await page
		.getByRole("button", { name: "Einstellungen", exact: true })
		.click();
	await page.getByLabel(/Daten-Gateway/).fill("");
	await page.getByRole("button", { name: "Suche" }).click();
	await page
		.getByLabel("Produkt oder Lebensmittel suchen")
		.fill("Produkt ohne Gateway");
	await page.getByRole("button", { name: "Suchen" }).click();

	const alert = page.getByRole("alert");
	await expect(alert).toContainText("Netzwerk- oder CORS-Fehler");
	await expect(alert).toContainText("Search-a-licious");
	await expect(alert).toContainText("Open Food Facts Legacy-Suche");
	await expect(alert.getByRole("button", { name: "Erneut versuchen" })).toBeEnabled();
	await expect(alert).toBeFocused();
	const errorA11y = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
		.analyze();
	expect(errorA11y.violations).toEqual([]);
});

test("persönliches OFF-Konto wird geprüft, lokal gespeichert und wieder entfernt", async ({
	page,
}) => {
	let loginBody = "";
	await page.route("https://world.openfoodfacts.org/cgi/auth.pl", async (route) => {
		loginBody = route.request().postData() ?? "";
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			headers: { "Access-Control-Allow-Origin": "*" },
			body: JSON.stringify({
				status: 1,
				user_id: "e2e-off-user",
				user: { name: "E2E OFF User" },
			}),
		});
	});

	await openApp(page);
	await page
		.getByRole("button", { name: "Einstellungen", exact: true })
		.click();
	await page.getByLabel("OFF-Benutzername").fill("e2e-off-user");
	await page.getByLabel("OFF-Passwort").fill("e2e password");
	await page.getByRole("button", { name: "Anmelden & lokal speichern" }).click();
	await expect(page.getByRole("status").filter({ hasText: /OFF-Konto e2e-off-user ist verbunden/ })).toBeVisible();
	const submitted = new URLSearchParams(loginBody);
	expect(submitted.get("user_id")).toBe("e2e-off-user");
	expect(submitted.get("password")).toBe("e2e password");

	await expect
		.poll(() => page.evaluate(() => localStorage.getItem("kh-checker-settings-v3")))
		.toContain("e2e-off-user");
	await page.reload();
	await page
		.getByRole("button", { name: "Einstellungen", exact: true })
		.click();
	await expect(page.getByLabel("OFF-Benutzername")).toHaveValue("e2e-off-user");
	await expect(page.getByRole("button", { name: "Konto entfernen" })).toBeVisible();
	await page.getByRole("button", { name: "Konto entfernen" }).click();
	await expect(page.getByLabel("OFF-Benutzername")).toHaveValue("");
	await expect(page.getByRole("button", { name: "Konto entfernen" })).toHaveCount(0);
});

test("leere Suche endet in einem expliziten Empty-State", async ({ page }) => {
	await page.route("**/api/v1/search*", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(searchPayload([])),
		}),
	);
	await openApp(page);
	await ensureGatewayConfigured(page);
	await page
		.getByLabel("Produkt oder Lebensmittel suchen")
		.fill("Garantiert leeres E2E Produkt");
	await page.getByRole("button", { name: "Suchen" }).click();
	await expect(page.getByRole("alert")).toContainText(
		/Keine passenden Produkte|nicht gefunden/i,
	);
	await expect(
		page.getByRole("alert").getByRole("button", { name: /Erneut versuchen/i }),
	).toBeEnabled();
	const emptyA11y = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
		.analyze();
	expect(emptyA11y.violations).toEqual([]);
});

for (const status of [429, 503]) {
	test(`HTTP ${status} zeigt Retry-Hinweis ohne lokalen Countdown`, async ({
		page,
		browserName,
	}) => {
		test.skip(
			browserName !== "chromium",
			"Statusvarianten laufen einmal; die Kernjourney läuft in allen Engines.",
		);
		let requests = 0;
		await page.route("**/api/v1/search*", (route) => {
			requests += 1;
			return route.fulfill({
				status,
				headers: { "Retry-After": "5" },
				contentType: "application/json",
				body: JSON.stringify({
					error: "Temporär nicht verfügbar.",
					traceId: `trace-e2e-${status}`,
				}),
			});
		});
		await openApp(page);
		await ensureGatewayConfigured(page);
		await page
			.getByLabel("Produkt oder Lebensmittel suchen")
			.fill(`E2E Limit ${status}`);
		await page.getByRole("button", { name: "Suchen" }).click();
		const alert = page.getByRole("alert");
		await expect(alert).toContainText(new RegExp(`HTTP ${status}`));
		await expect(alert).toContainText(/sofort|Retry-After/i);
		const retry = alert.getByRole("button", { name: /erneut|neu starten/i });
		await expect(retry).toBeEnabled();
		await retry.click();
		await expect.poll(() => requests).toBeGreaterThanOrEqual(2);
	});
}

test("malformed HTTP-200-Payload wird als Contractfehler sichtbar", async ({
	page,
	browserName,
}) => {
	test.skip(
		browserName !== "chromium",
		"Schemafehler läuft einmal; Kernjourneys laufen in allen Engines.",
	);
	await page.route("**/api/v1/search*", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ hits: "kein-array" }),
		}),
	);
	await openApp(page);
	await ensureGatewayConfigured(page);
	await page
		.getByLabel("Produkt oder Lebensmittel suchen")
		.fill("Malformed E2E");
	await page.getByRole("button", { name: "Suchen" }).click();
	await expect(page.getByRole("alert")).toContainText(
		/Ungültige API-Antwort|verletzt den API-Vertrag/i,
	);
});

test("Kandidatenwahl hydratisiert genau ein Produkt und führt zum Ergebnis", async ({
	page,
}) => {
	const codeA = "4000000000001";
	const codeB = "4000000000002";
	let productRequests = 0;
	await page.route("**/api/v1/search*", (route) =>
		route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(
				searchPayload([
					{
						code: codeA,
						product_name_de: "E2E Auswahlriegel Klassik",
						brands: "E2E Marke",
						quantity: "50 g",
						countries_tags: ["en:germany"],
						completeness: 0.9,
						nutriments: { carbohydrates_100g: 40 },
					},
					{
						code: codeB,
						product_name_de: "E2E Auswahlriegel Kakao",
						brands: "E2E Marke",
						quantity: "55 g",
						countries_tags: ["en:germany"],
						completeness: 0.8,
						nutriments: { carbohydrates_100g: 42 },
					},
				]),
			),
		}),
	);
	await page.route(`**/api/v1/product/${codeA}*`, (route) => {
		productRequests += 1;
		return route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(productPayload(codeA)),
		});
	});

	await openApp(page);
	await ensureGatewayConfigured(page);
	await page
		.getByLabel("Produkt oder Lebensmittel suchen")
		.fill("E2E Auswahlriegel Variante");
	await page.getByRole("button", { name: "Suchen" }).click();
	const candidatesHeading = page.getByRole("heading", {
		name: "Produkt auswählen",
	});
	const resultHeading = page.getByRole("heading", { name: "Ergebnis" });
	await expect(candidatesHeading.or(resultHeading)).toBeVisible();
	if (await resultHeading.isVisible()) {
		await page.getByRole("button", { name: "Produkt wählen" }).click();
	}
	await expect(candidatesHeading).toBeVisible();
	const candidateA11y = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
		.analyze();
	expect(candidateA11y.violations).toEqual([]);
	await page.goBack();
	await expect(page.getByRole("heading", { name: "Ergebnis" })).toBeVisible();
	await page.goBack();
	await expect(
		page.getByRole("heading", { name: "Welches Produkt oder Lebensmittel?" }),
	).toBeVisible();
	await page.goForward();
	await expect(page.getByRole("heading", { name: "Ergebnis" })).toBeVisible();
	await page.goForward();
	await expect(
		page.getByRole("heading", { name: "Produkt auswählen" }),
	).toBeVisible();
	await page.getByRole("button", { name: /E2E Auswahlriegel Klassik/ }).click();
	await expect(page.getByRole("heading", { name: "Ergebnis" })).toBeVisible();
	await expect(
		page.getByText("E2E Auswahlriegel", { exact: true }),
	).toBeVisible();
	await expect(page.getByRole("note")).toContainText(/Etikett prüfen|Insulindosierung/i);
	await expect(page.getByRole("note")).toContainText(
		"Produktdaten: Open Food Facts",
	);
	expect(productRequests).toBe(1);

	const results = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
		.analyze();
	expect(results.violations).toEqual([]);
});

test("7-stelliger UPC-E-Barcode erreicht den versionierten Produktpfad", async ({
	page,
	browserName,
}) => {
	test.skip(browserName !== "chromium", "Barcode-Grenzfall läuft einmal.");
	const enteredCode = "1234567";
	const canonicalCode = `0${enteredCode}`;
	let requested = "";
	await page.route(`**/api/v1/product/${canonicalCode}*`, (route) => {
		requested = route.request().url();
		return route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify(productPayload(canonicalCode)),
		});
	});
	await openApp(page);
	await ensureGatewayConfigured(page);
	await page.getByLabel("Produkt oder Lebensmittel suchen").fill(enteredCode);
	await page.getByRole("button", { name: "Suchen" }).click();
	await expect(page.getByRole("heading", { name: "Ergebnis" })).toBeVisible();
	expect(requested).toContain(`/api/v1/product/${canonicalCode}`);
});

test.describe("Offline-Cache mit echtem Service Worker", () => {
	test.use({ serviceWorkers: "allow" });

	test("offline wird ein abgelaufener aber gültiger Suchcache sichtbar als stale verwendet", async ({
		page,
		context,
		browserName,
	}) => {
		test.skip(
			browserName !== "chromium",
			"IndexedDB-/Service-Worker-Reserve läuft einmal im Chromium-Pfad.",
		);
		const query = "E2E Offline Cache Auswahl";
		const hits = [
			{
				code: "4000000000011",
				product_name_de: "Offline Auswahl A",
				brands: "E2E",
				quantity: "50 g",
				nutriments: { carbohydrates_100g: 35 },
			},
			{
				code: "4000000000012",
				product_name_de: "Offline Auswahl B",
				brands: "E2E",
				quantity: "55 g",
				nutriments: { carbohydrates_100g: 36 },
			},
		];
		const routeHandler = (route: Route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(searchPayload(hits)),
			});
		await page.route("**/api/v1/search*", routeHandler);
		await openApp(page);
		await ensureGatewayConfigured(page);
		await page.getByRole("button", { name: "Einstellungen", exact: true }).click();
		await page.getByLabel("API-Daten für Offline-Nutzung speichern").check();
		await page.getByRole("button", { name: "Suche" }).click();
		await page.getByLabel("Produkt oder Lebensmittel suchen").fill(query);
		await page.getByRole("button", { name: "Suchen" }).click();
		await expect(
			page.getByRole("heading", { name: "Produkt auswählen" }),
		).toBeVisible();
		await page.getByRole("button", { name: "Zurück zur Suche" }).click();
		await page.waitForTimeout(300);

		await page.evaluate(async () => {
			const now = Date.now();
			const raw = localStorage.getItem("kh-checker-v2.2-api-cache-fallback");
			if (raw) {
				const entries = JSON.parse(raw);
				for (const entry of entries) {
					entry.storedAt = now - 2 * 24 * 60 * 60 * 1000;
					entry.expiresAt = now - 1;
					entry.staleUntil = now + 24 * 60 * 60 * 1000;
				}
				localStorage.setItem(
					"kh-checker-v2.2-api-cache-fallback",
					JSON.stringify(entries),
				);
			}
			await new Promise<void>((resolve) => {
				const request = indexedDB.open("kh-checker-v1", 3);
				request.onerror = () => resolve();
				request.onsuccess = () => {
					const db = request.result;
					const tx = db.transaction("api-cache", "readwrite");
					const store = tx.objectStore("api-cache");
					const all = store.getAll();
					all.onsuccess = () => {
						for (const entry of all.result) {
							entry.storedAt = now - 2 * 24 * 60 * 60 * 1000;
							entry.expiresAt = now - 1;
							entry.staleUntil = now + 24 * 60 * 60 * 1000;
							store.put(entry);
						}
					};
					tx.oncomplete = () => {
						db.close();
						resolve();
					};
					tx.onerror = () => {
						db.close();
						resolve();
					};
				};
			});
		});
		await page.unroute("**/api/v1/search*", routeHandler);
		await context.setOffline(true);
		try {
			await page.reload({ waitUntil: "domcontentloaded" });
			await page.getByLabel("Produkt oder Lebensmittel suchen").fill(query);
			await page.getByRole("button", { name: "Suchen" }).click();
			await expect(
				page.getByText(/Gespeicherte Daten verwendet/),
			).toBeVisible();
			await expect(
				page.getByRole("heading", { name: "Produkt auswählen" }),
			).toBeVisible();
		} finally {
			await context.setOffline(false);
		}
	});
});

test("destruktives Löschen verlangt eine Bestätigung", async ({
	page,
	browserName,
}) => {
	test.skip(browserName !== "chromium", "Dialogvertrag läuft einmal.");
	await openApp(page);
	await page
		.getByRole("button", { name: "Einstellungen", exact: true })
		.click();
	let confirmationMessage = "";
	let confirmationType = "";
	page.once("dialog", async (dialog) => {
		confirmationMessage = dialog.message();
		confirmationType = dialog.type();
		await dialog.dismiss();
	});
	await page.getByRole("button", { name: "Verlauf löschen" }).click();
	expect(confirmationType).toBe("confirm");
	expect(confirmationMessage).toMatch(/unwiderruflich/i);
});

test("Startansicht erfüllt den automatisierten WCAG-A/AA-Smoke", async ({
	page,
}) => {
	await openApp(page);
	const results = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
		.analyze();
	expect(results.violations).toEqual([]);
});

test("Settings erfüllen den automatisierten WCAG-A/AA-Smoke", async ({
	page,
}) => {
	await openApp(page);
	await page
		.getByRole("button", { name: "Einstellungen", exact: true })
		.click();
	const results = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
		.analyze();
	expect(results.violations).toEqual([]);
});

test("320-px-Reflow, echter 400-%-CSS-Zoom, 200-%-Schrift, Touch und Reduced Motion bleiben nutzbar", async ({
	page,
	browserName,
}) => {
	test.skip(
		browserName !== "chromium",
		"Layout-Extremprofile laufen einmal; Kernansichten laufen in allen Engines.",
	);
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.emulateMedia({ reducedMotion: "reduce" });
	await openApp(page);
	await page.evaluate(() => {
		document.documentElement.style.zoom = "400%";
	});
	await expect
		.poll(() =>
			page.evaluate(() => getComputedStyle(document.documentElement).zoom),
		)
		.toBe("4");
	const zoomed = await page.evaluate(() => {
		const viewport = document.documentElement.clientWidth;
		const probe = document.createElement("div");
		probe.className = "spin";
		probe.setAttribute("aria-hidden", "true");
		document.body.append(probe);
		const probeStyle = getComputedStyle(probe);
		const spinDuration = probeStyle.animationDuration;
		const spinIterations = probeStyle.animationIterationCount;
		const mediaMatches = matchMedia("(prefers-reduced-motion: reduce)").matches;
		probe.remove();
		return {
			viewport,
			content: document.documentElement.scrollWidth,
			mediaMatches,
			overflowing: [...document.querySelectorAll<HTMLElement>("body *")]
				.filter((element) => {
					const bounds = element.getBoundingClientRect();
					return (
						element.offsetParent !== null &&
						(bounds.left < -1 || bounds.right > viewport + 1)
					);
				})
				.map((element) => ({
					className: element.className,
					tagName: element.tagName,
					text: element.textContent?.trim().slice(0, 80),
					bounds: element.getBoundingClientRect().toJSON(),
				})),
			touchTargets: [
				...document.querySelectorAll<HTMLElement>(
					'.bottom-nav button, .primary-button, .secondary-button, .voice-button, .icon-button, [role="tab"]',
				),
			]
				.filter((element) => element.offsetParent !== null)
				.map((element) => ({
					width: element.getBoundingClientRect().width,
					height: element.getBoundingClientRect().height,
				})),
			spinDuration,
			spinIterations,
		};
	});
	expect(
		zoomed.overflowing,
		JSON.stringify(zoomed.overflowing, null, 2),
	).toEqual([]);
	expect(zoomed.content).toBeLessThanOrEqual(zoomed.viewport + 1);
	expect(zoomed.touchTargets.length).toBeGreaterThan(0);
	expect(
		zoomed.touchTargets.every(
			(target) => target.width >= 44 && target.height >= 44,
		),
	).toBeTruthy();
	expect(zoomed.mediaMatches).toBeTruthy();
	expect(zoomed.spinIterations).toBe("1");
	const reducedDurationMs = zoomed.spinDuration.endsWith("ms")
		? Number.parseFloat(zoomed.spinDuration)
		: Number.parseFloat(zoomed.spinDuration) * 1000;
	expect(reducedDurationMs).toBeLessThanOrEqual(0.01);

	await page.evaluate(() => {
		document.documentElement.style.zoom = "";
		document.documentElement.setAttribute("data-font-scale", "2");
	});
	await page.setViewportSize({ width: 320, height: 568 });
	await expect
		.poll(() =>
			page.evaluate(() => getComputedStyle(document.documentElement).fontSize),
		)
		.toBe("32px");
	const portrait = await page.evaluate(() => ({
		viewport: document.documentElement.clientWidth,
		content: document.documentElement.scrollWidth,
	}));
	expect(portrait.content).toBeLessThanOrEqual(portrait.viewport + 1);

	await page.setViewportSize({ width: 568, height: 320 });
	const landscape = await page.evaluate(() => ({
		viewport: document.documentElement.clientWidth,
		content: document.documentElement.scrollWidth,
	}));
	expect(landscape.content).toBeLessThanOrEqual(landscape.viewport + 1);
});

test.describe("PWA mit echtem Service Worker", () => {
	test.use({ serviceWorkers: "allow" });

	test("Service-Worker Status und expliziter Update-Prompt schützen laufende Eingaben", async ({
		page,
	}, testInfo) => {
		test.skip(testInfo.project.name !== "chromium-desktop", "PWA-Eventvertrag läuft einmal.");
		await openApp(page);
		for (const message of [
			"Die App ist jetzt für die Offline-Nutzung vorbereitet.",
			"Offline-Funktion konnte nicht vorbereitet werden: Testfehler",
		]) {
			await page.evaluate(
				(detail) =>
					window.dispatchEvent(
						new CustomEvent("kh:pwa-status", { detail: { message: detail } }),
					),
				message,
			);
			await expect(
				page.getByRole("status").filter({ hasText: message }),
			).toBeVisible();
		}

		const query = page.getByLabel("Produkt oder Lebensmittel suchen");
		await query.fill("ungespeicherter Entwurf");
		await page.evaluate(() => {
			(window as Window & { __khPwaApplied?: number }).__khPwaApplied = 0;
			window.dispatchEvent(new CustomEvent("kh:pwa-update-available", {
				detail: {
					apply: () => {
						(window as Window & { __khPwaApplied?: number }).__khPwaApplied = 1;
					},
				},
			}));
		});
		await expect(page.getByText("Eine neue App-Version ist verfügbar.", { exact: false })).toBeVisible();
		await page.getByRole("button", { name: "Später" }).click();
		await expect(query).toHaveValue("ungespeicherter Entwurf");
		expect(await page.evaluate(() => (window as Window & { __khPwaApplied?: number }).__khPwaApplied)).toBe(0);

		await page.evaluate(() => {
			window.dispatchEvent(new CustomEvent("kh:pwa-update-available", {
				detail: {
					apply: () => {
						(window as Window & { __khPwaApplied?: number }).__khPwaApplied = 1;
					},
				},
			}));
		});
		await page.getByRole("button", { name: "Jetzt aktualisieren" }).click();
		expect(await page.evaluate(() => (window as Window & { __khPwaApplied?: number }).__khPwaApplied)).toBe(1);
	});

	test("Manifest und Service Worker sind erreichbar und registrierbar", async ({
		page,
	}) => {
		await openApp(page);
		const manifest = await page.request.get("/manifest.webmanifest");
		expect(manifest.ok()).toBeTruthy();
		expect((await manifest.json()).display).toBe("standalone");

		const serviceWorker = await page.request.get("/sw.js");
		expect(serviceWorker.ok()).toBeTruthy();
		await page.waitForFunction(async () => {
			if (!("serviceWorker" in navigator)) return false;
			const registration = await navigator.serviceWorker.ready;
			return Boolean(registration.active);
		});
	});

	test("App-Shell lädt nach dem Precache auch offline neu", async ({
		page,
		context,
		browserName,
	}) => {
		test.skip(
			browserName !== "chromium",
			"Offline-Service-Worker-Smoke läuft einmal im Chromium-Pfad.",
		);
		await openApp(page);
		await page.waitForFunction(async () => {
			if (!("serviceWorker" in navigator)) return false;
			const registration = await navigator.serviceWorker.ready;
			return Boolean(registration.active);
		});
		await page.reload();
		await expect(
			page.getByRole("heading", { name: "Welches Produkt oder Lebensmittel?" }),
		).toBeVisible();
		await page
			.getByRole("button", { name: "Einstellungen", exact: true })
			.click();
		await page
			.getByRole("button", { name: "API-Zwischenspeicher leeren" })
			.click();
		await page.getByRole("button", { name: "Suche", exact: true }).click();
		await context.setOffline(true);
		try {
			await page.reload({ waitUntil: "domcontentloaded" });
			await expect(
				page.getByRole("heading", {
					name: "Welches Produkt oder Lebensmittel?",
				}),
			).toBeVisible();
		} finally {
			await context.setOffline(false);
		}
	});
});
