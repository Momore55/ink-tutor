"""Local Ink Tutor server. Set GEMINI_API_KEY before starting."""
import json
import os
import re
import subprocess
import urllib.error
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from canvas_agent import stream_strokes


def load_model_config():
    """Pin provider model IDs in a non-secret project configuration file."""
    config = json.loads(Path(__file__).with_name("ink-config.json").read_text(encoding="utf-8"))
    model_ids = [config["liveModelId"], config["textModelId"]]
    if not all(isinstance(value, str) and re.fullmatch(r"(?:models/)?[A-Za-z0-9][A-Za-z0-9._-]{1,120}", value) for value in model_ids):
        raise ValueError("Invalid model identifier")
    return "models/" + model_ids[0].removeprefix("models/"), model_ids[1].removeprefix("models/")


class Handler(SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path not in {"/voice-session", "/board-lines", "/math-expression", "/math-solve", "/canvas-actions"}:
            return self.send_error(404)
        host = self.headers.get("Host")
        if host not in {"127.0.0.1:7860", "localhost:7860"} or self.headers.get("Origin") != f"http://{host}":
            return self.send_error(403, "Open Ink Tutor on localhost.")
        if self.path == "/math-solve":
            return self.math_problem()
        key = os.environ.get("GEMINI_API_KEY")
        if not key:
            return self.send_error(503, "Set GEMINI_API_KEY on the local server.")
        try:
            model, text_model = load_model_config()
        except (OSError, ValueError, KeyError, TypeError):
            return self.send_error(503, "Check ink-config.json model identifiers.")
        if self.path == "/board-lines":
            return self.board_lines(key, text_model)
        if self.path == "/math-expression":
            return self.math_problem(key, text_model)
        if self.path == "/canvas-actions":
            return self.canvas_actions(key,text_model)
        request = urllib.request.Request(
            "https://generativelanguage.googleapis.com/v1beta/auth_tokens",
            data=json.dumps({"uses": 1}).encode(),
            headers={"x-goog-api-key": key, "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                body = json.dumps({"token": json.load(response)["name"], "model": model}).encode()
        except urllib.error.HTTPError as error:
            try:
                details = json.load(error).get("error", {}).get("details", [])
                reasons = {
                    "API_KEY_INVALID", "API_KEY_EXPIRED", "API_KEY_SERVICE_BLOCKED",
                    "SERVICE_DISABLED", "BILLING_DISABLED",
                }
                for detail in details:
                    reason = detail.get("reason")
                    if reason in reasons:
                        self.log_error("Gemini token request: %s", reason)
            except (OSError, ValueError, TypeError, AttributeError):
                pass
            return self.send_error(502, f"Gemini rejected the session request (HTTP {error.code}).")
        except (OSError, ValueError, KeyError):
            return self.send_error(502, "Could not reach Gemini or read its session response.")
        self.send_json(body)

    def canvas_actions(self,key,model):
        try:
            size=int(self.headers.get("Content-Length","0"))
            if not 0<size<=2_200_000:raise ValueError
            payload=json.loads(self.rfile.read(size))
            if not isinstance(payload,dict) or any(not isinstance(payload.get(name),str) or not 0<len(payload[name])<=4000 for name in ["intent","narration"]):raise ValueError
            if not isinstance(payload.get("board",[]),list) or len(payload.get("board",[]))>32:raise ValueError
            if payload.get("image") is not None and (not isinstance(payload["image"],str) or len(payload["image"])>1_800_000 or not re.fullmatch(r"[A-Za-z0-9+/=]+",payload["image"])):raise ValueError
        except (ValueError,TypeError):return self.send_error(400,"Supply a bounded canvas intent and narration.")
        self.send_response(200);self.send_header("Content-Type","application/x-ndjson")
        self.send_header("Cache-Control","no-store");self.send_header("X-Accel-Buffering","no");self.end_headers()
        def emit(value):self.wfile.write((json.dumps(value)+"\n").encode());self.wfile.flush()
        try:
            for stroke in stream_strokes(key,model,payload):emit({"type":"stroke","stroke":stroke})
            emit({"type":"done"})
        except (BrokenPipeError,ConnectionResetError):return
        except (OSError,ValueError,KeyError,TypeError):
            try:emit({"type":"error","message":"The canvas specialist could not finish. Voice can continue; retry the illustration."})
            except (BrokenPipeError,ConnectionResetError):pass

    def math_problem(self, key=None, text_model=None):
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 5_600_000:
                raise ValueError
            payload = json.loads(self.rfile.read(size))
            if not isinstance(payload, dict):
                raise ValueError
            problem = payload.get("problem", "")
            photo = payload.get("photo")
            if not isinstance(problem, str) or len(problem) > 1500:
                raise ValueError
            if photo is not None and (
                not isinstance(photo, dict) or photo.get("mimeType") not in {"image/png", "image/jpeg", "image/webp"}
                or not isinstance(photo.get("data"), str) or not photo["data"]
            ):
                raise ValueError
            if not problem.strip() and (not photo or not key):
                raise ValueError
        except (ValueError, TypeError):
            return self.send_error(400, "Enter a problem or choose a supported photo under 4 MB.")

        if key:
            parts = [{"text": problem}]
            if photo:
                parts.append({"inlineData": photo})
            request = urllib.request.Request(
                f"https://generativelanguage.googleapis.com/v1beta/models/{text_model}:generateContent",
                headers={"x-goog-api-key": key, "Content-Type": "application/json"},
                data=json.dumps({
                    "systemInstruction": {"parts": [{"text": (
                        "Transcribe the image equation or translate the word problem into one unsolved "
                        "LaTeX equation or arithmetic expression, with all numerical values substituted. "
                        "Preserve the relationships and operations described by the problem. "
                        "Do not calculate or guess missing information. "
                        "Return an empty expression if ambiguous or not reducible to one formula."
                    )}]},
                    "contents": [{"parts": parts}],
                    "generationConfig": {
                        "responseMimeType": "application/json",
                        "responseJsonSchema": {
                            "type": "object", "required": ["expression"],
                            "properties": {"expression": {"type": "string"}},
                        },
                    },
                }).encode(),
            )
            try:
                with urllib.request.urlopen(request, timeout=20) as response:
                    parts = json.load(response)["candidates"][0]["content"]["parts"]
                expression = json.loads("".join(p.get("text", "") for p in parts if not p.get("thought")))["expression"]
                if not isinstance(expression, str) or not 0 < len(expression.strip()) <= 500:
                    return self.send_error(422, "Could not read one formula. Enter it manually.")
            except (OSError, ValueError, KeyError, IndexError, TypeError):
                return self.send_error(502, "Could not read the problem with Gemini. Enter the formula manually.")
            return self.send_json(json.dumps({"expression": expression}).encode())

        if len(problem) > 500 or photo is not None:
            return self.send_error(400, "Enter one equation or expression under 500 characters.")
        try:
            result = subprocess.run(
                ["node", str(Path(__file__).resolve().with_name("openmath-solver.mjs"))],
                input=problem, capture_output=True, encoding="utf-8", timeout=5, check=True,
                env={name: value for name, value in os.environ.items() if name.upper() != "GEMINI_API_KEY"},
            )
            solution = json.loads(result.stdout)
        except (OSError, ValueError, subprocess.SubprocessError):
            return self.send_error(503, "OpenMath is unavailable. Check that Node 24 and the OpenMath checkout are installed.")
        if "error" in solution:
            return self.send_error(422, solution["error"])
        self.send_json(json.dumps(solution).encode())

    def board_lines(self, key, text_model):
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 2500000:
                raise ValueError
            payload = json.loads(self.rfile.read(size))
            transcript = payload["transcript"]
            question = payload.get("question", "")
            audio = payload.get("audio")
            previous_lines = payload.get("previousLines", [])
            previous_explanation = payload.get("previousExplanation", "")
            if not isinstance(transcript, str) or not isinstance(question, str):
                raise ValueError
            if audio is not None and (
                not isinstance(audio, dict) or audio.get("mimeType") != "audio/webm"
                or not isinstance(audio.get("data"), str) or not audio["data"]
            ):
                raise ValueError
            if not (transcript.strip() or question.strip() or audio):
                raise ValueError
            if not isinstance(previous_lines, list) or not all(isinstance(line, str) for line in previous_lines):
                raise ValueError
            if not isinstance(previous_explanation, str):
                raise ValueError
        except (ValueError, KeyError, TypeError):
            return self.send_error(400, "Expected a short tutor transcript.")

        parts = [{"text": json.dumps({
            "tutorTranscript": transcript,
            "studentQuestion": question,
            "previousBoardLines": previous_lines,
            "previousExplanation": previous_explanation,
        })}]
        if audio:
            parts.append({"inlineData": audio})
            self.log_message("Received a voice recording for the board (%d encoded bytes).", len(audio["data"]))
        request = urllib.request.Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{text_model}:generateContent",
            data=json.dumps({
                "systemInstruction": {"parts": [{"text": (
                    "Convert supplied content into whiteboard data. Extract math from tutorTranscript, "
                    "or from studentQuestion or attached audio when no tutor transcript is supplied. "
                    "Transcribe only the expressions and calculations explicitly present, in their original order. "
                    "Use previousBoardLines and previousExplanation only to resolve references. "
                    "Do not solve, extend the lesson, generate exercises, or choose teaching pace. "
                    "Return up to eight short math lines using supported notation, and an explanation "
                    "that summarizes only what was supplied. Return empty lines and explanation if there "
                    "is nothing to extract. Use braces for powers and subscripts and LaTeX fractions. "
                    "Do not include markdown or prose in math lines."
                )}]},
                "contents": [{"parts": parts}],
                "generationConfig": {
                    "thinkingConfig": {"thinkingLevel": "LOW"},
                    "responseMimeType": "application/json",
                    "responseJsonSchema": {
                        "type": "object",
                        "properties": {
                            "lines": {"type": "array", "items": {"type": "string"}, "maxItems": 8},
                            "explanation": {"type": "string"},
                        },
                        "required": ["lines", "explanation"],
                    },
                },
            }).encode(),
            headers={"x-goog-api-key": key, "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                reply = json.load(response)
            candidates = reply.get("candidates") or []
            candidate = candidates[0] if candidates else {}
            parts = candidate.get("content", {}).get("parts", [])
            answer = "".join(part.get("text", "") for part in parts if not part.get("thought")).strip()
            if not answer:
                reason = candidate.get("finishReason") or reply.get("promptFeedback", {}).get("blockReason")
                if reason in {"MAX_TOKENS", "SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST", "OTHER"}:
                    self.log_error("Gemini returned no board answer (%s).", reason)
                return self.send_error(502, "Gemini returned no board answer. Try a short, clear recording.")
            result = json.loads(answer)
            lines = result["lines"]
            explanation = result["explanation"]
            if not isinstance(lines, list) or not all(isinstance(line, str) for line in lines):
                raise ValueError
            if not isinstance(explanation, str):
                raise ValueError
        except urllib.error.HTTPError as error:
            return self.send_error(502, f"Gemini rejected the board request (HTTP {error.code}).")
        except TimeoutError:
            return self.send_error(504, "Gemini timed out while preparing the whiteboard.")
        except OSError as error:
            if isinstance(getattr(error, "reason", None), TimeoutError):
                return self.send_error(504, "Gemini timed out while preparing the whiteboard.")
            return self.send_error(502, "The server could not reach Gemini.")
        except (ValueError, KeyError, IndexError, TypeError, AttributeError) as error:
            self.log_error("Gemini board response could not be decoded (%s).", type(error).__name__)
            return self.send_error(502, "Gemini returned a board response the server could not read.")
        self.send_json(json.dumps({"lines": lines[:8], "explanation": explanation}).encode())

    def send_json(self, body):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

if __name__ == "__main__":
    root = Path(__file__).resolve().parent / "dist"
    with ThreadingHTTPServer(("127.0.0.1", 7860), partial(Handler, directory=str(root))) as server:
        print("Ink Tutor is ready at http://127.0.0.1:7860/ (board diagnostics enabled)", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
