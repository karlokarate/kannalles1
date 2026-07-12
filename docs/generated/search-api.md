# KH Checker data gateway API

Version **2.2.4**, OpenAPI **3.1.0**.

| Methode | Pfad | operationId | Beschreibung | Statuscodes |
|---|---|---|---|---|
| POST | `/api/v1/ai/parse` | `parseFoodRequest` | Mehrdeutige Nutzereingabe optional strukturieren | 200, 400, 413, 429, 500, 502, 503, 504 |
| GET | `/api/v1/health` | `gatewayHealth` | Status und Capabilities des Daten-Gateways lesen | 200, 503 |
| GET | `/api/v1/product/{code}` | `productByBarcode` | Nur das ausgewählte Produkt hydratisieren | 200, 400, 404, 413, 429, 500, 502, 503, 504 |
| GET | `/api/v1/search` | `searchProducts` | Produkte über das explizit konfigurierte Gateway suchen | 200, 400, 413, 429, 500, 502, 503, 504 |
