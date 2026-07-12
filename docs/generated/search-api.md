# KH Checker optional gateway API

Version **2.2.4**, OpenAPI **3.1.0**.

| Methode | Pfad | operationId | Beschreibung | Statuscodes |
|---|---|---|---|---|
| POST | `/api/ai/parse` | `parseFoodRequest` | Mehrdeutige Nutzereingabe optional strukturieren | 200, 400, 429, 502, 503 |
| GET | `/api/health` | `gatewayHealth` | Status des optionalen Gateways lesen | 200 |
| GET | `/api/product/{code}` | `productByBarcode` | Nur das ausgewählte Produkt hydratisieren | 200, 400, 404, 429, 502, 503 |
| GET | `/api/search` | `searchProducts` | Produkte über das explizit konfigurierte Gateway suchen | 200, 400, 429, 502, 503 |
