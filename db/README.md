# Norte — la base de datos

`data/market/*.json` en el repo sigue siendo la fuente de verdad, gobernada
por el skill `finance-market-data`. Estas tablas son la copia servida: se
siembran desde el repo, no se editan a mano y la app nunca les escribe.

## Por qué el esquema se ve así

Cada tabla de mercado guarda la fila original completa en una columna `raw`
de tipo `jsonb`, y todas las columnas tipadas se **generan** a partir de ella.

La razón es un detalle del motor, no una preferencia de estilo. El conjunto de
datos guarda centinelas junto a los números:

| valor            | significado                        | `knownNum` | `cap` |
|------------------|------------------------------------|-----------|-------|
| `350`            | trescientos cincuenta pesos        | `350`     | `350` |
| `UNKNOWN`        | el emisor no lo publica            | `null`    | `null` |
| `NOT_APPLICABLE` | no existe esa comisión             | `null`    | `Infinity` |
| `UNCAPPED`       | no hay tope                        | `null`    | `Infinity` |

`UNKNOWN` y `UNCAPPED` se ven iguales para un conteo de filas y significan lo
contrario para el motor. Si se colapsan a `NULL`, una bonificación sin tope se
convierte en una bonificación con tope de cero y el scoring cambia. Por eso la
fila original tiene que sobrevivir intacta.

Tres cosas se obtienen gratis con este diseño:

1. **No hay dos copias que se separen.** Las columnas tipadas se derivan de
   `raw`, así que no pueden contradecirla.
2. **SQL sigue siendo posible.** `norte_num()` devuelve `NULL` en un centinela
   y `norte_sentinel()` dice cuál era, así que una consulta puede distinguir
   "no publicado" de "no aplica" sin meterse al JSON a mano.
3. **El esquema no estorba.** Una columna nueva que agregue el skill aterriza
   en `raw` sin migración. Solo se tipa cuando algo necesita consultarla.

## Aplicarlo

```bash
# la cadena de conexión sale de Supabase, en Settings > Database
export DATABASE_URL='postgresql://postgres:...@db....supabase.co:5432/postgres'

psql "$DATABASE_URL" -f db/schema.sql
node db/seed.mjs && psql "$DATABASE_URL" -f db/seed.sql
```

`schema.sql` es idempotente: se puede volver a correr. El seed borra y
reescribe todas las tablas de mercado, que es lo correcto cuando el repo manda.

Las políticas de row level security se aplican solas en Supabase. Fuera de
Supabase se saltan con un aviso, porque `auth.uid()` no existe ahí; así el
mismo archivo corre en un Postgres local para pruebas.

## Verificarlo

Dos pruebas, y las dos importan.

```bash
# 1. el viaje de ida y vuelta no perdió nada
psql "$DATABASE_URL" -tA -c 'select bootstrap_market()' > /tmp/bootstrap.json
node db/verify.mjs /tmp/bootstrap.json

# 2. el motor da las mismas respuestas con los datos de la base
node tools/golden.mjs --check --market /tmp/bootstrap.json
```

La primera compara 9,373 campos uno por uno, incluidos los 2,591 centinelas.
La segunda corre los 257 casos del motor con los datos saliendo de Postgres en
lugar del repo. Si las dos pasan, la base es una copia fiel y la migración de
datos está probada.

## Lo que todavía no está aquí

- **Auth.** Las tablas de usuario existen y tienen RLS, pero nadie se
  autentica todavía. Eso entra con Sign in with Apple.
- **La migración de los usuarios actuales** desde el Google Sheet.
- **El reemplazo de `apiGet` y `apiPost`** en `src/app.jsx`, para que la web
  hable con Supabase y no queden dos verdades.
