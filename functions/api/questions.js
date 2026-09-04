import { QUESTIONS } from "../../shared/questions.js";
import { json } from "../../shared/http.js";

export const onRequestGet = () =>
  json({ questions: QUESTIONS }, { cache: "public, max-age=300" });
