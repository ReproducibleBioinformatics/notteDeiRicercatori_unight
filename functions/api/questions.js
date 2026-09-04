import { QUESTIONS } from "../../shared/questions.js";
import { ANIMALS } from "../../shared/animals.js";
import { json } from "../../shared/http.js";

export const onRequestGet = () =>
  json({ questions: QUESTIONS, animals: ANIMALS }, { cache: "public, max-age=300" });
