import { MODEL } from "../../shared/model.js";
import { ANIMALS } from "../../shared/animals.js";
import { json } from "../../shared/http.js";

// Solo cio' che serve al display: i punti di riferimento e la legenda.
// I loadings restano lato server, non c'e' motivo di spedirli al browser.
export const onRequestGet = () =>
  json(
    {
      version: MODEL.version,
      explained: MODEL.explained,
      axes: MODEL.axes,
      animals: ANIMALS,
      clusters: MODEL.clusters.map(({ id, name, blurb, color }) => ({ id, name, blurb, color })),
      ref: { xy: MODEL.ref.xy, uxy: MODEL.ref.uxy, cluster: MODEL.ref.cluster },
    },
    { cache: "public, max-age=3600" }
  );
