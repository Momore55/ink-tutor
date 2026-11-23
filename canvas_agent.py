"""A separate vision-capable drawing specialist; never handles microphone audio."""
import json
import math
import re
import urllib.request

DRAWING_CONTRACT = """You are the canvas specialist for a live teacher. Convert the supplied visual intent and planned narration into generic vector strokes on a 900 by 620 board. Use the supplied current canvas image and confirmed scene state to avoid overlap. Do not teach, answer the learner, or generate program code. Return JSON with a strokes array. Each stroke has id, type (freedraw, text, primitive), onsetOffsetMs, durationMs, points [{x,y}], color (#RRGGBB), width. Text strokes also have text and math (boolean). Use text with math=true for textbook equations, and freehand point trajectories for arbitrary illustrations. Points stay inside x=10..880, y=10..610. Maximum 24 strokes and 1024 points per stroke. Use sparse legible paths, not a dense raster trace. Timing is an estimate relative to the associated narration's first audio sample, not network arrival. Read the narration in order; spread onsets and durations across its estimated spoken duration. Do not claim your estimated times are measured spoken-word timestamps. Do not output external URLs or executable content. Respect existing objects and keep new geometry within the available space."""

def validate_stroke(value):
    if not isinstance(value, dict): raise ValueError("Stroke must be an object.")
    stroke_id, kind = value.get("id"), value.get("type")
    if not isinstance(stroke_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", stroke_id): raise ValueError("Invalid stroke identifier.")
    if kind not in {"freedraw", "text", "primitive"}: raise ValueError("Invalid stroke type.")
    def number(key, low, high, default=None):
        result=value.get(key,default)
        if isinstance(result,bool) or not isinstance(result,(int,float)) or not math.isfinite(result) or not low<=result<=high: raise ValueError("Invalid stroke " + key)
        return result
    onset, duration=number("onsetOffsetMs",0,60000),number("durationMs",16,60000)
    points=value.get("points")
    if not isinstance(points,list) or not (1 if kind=="text" else 2)<=len(points)<=1024: raise ValueError("Invalid vector point count.")
    clean=[]
    for point in points:
        if not isinstance(point,dict): raise ValueError("Invalid vector point.")
        x,y=point.get("x"),point.get("y")
        if any(isinstance(n,bool) or not isinstance(n,(int,float)) or not math.isfinite(n) for n in [x,y]) or not 10<=x<=880 or not 10<=y<=610: raise ValueError("Point outside board.")
        clean.append({"x":x,"y":y})
    color=value.get("color","#eeeedd")
    if not isinstance(color,str) or not re.fullmatch(r"#[a-fA-F0-9]{6}",color): raise ValueError("Invalid pen color.")
    result={"id":stroke_id,"type":kind,"onsetOffsetMs":onset,"durationMs":duration,"points":clean,"color":color,"width":number("width",.5,12,3)}
    if kind=="text":
        text=value.get("text")
        if not isinstance(text,str) or not 0<len(text)<=240: raise ValueError("Invalid stroke text.")
        result.update(text=text,math=value.get("math") is True)
    return result

class StrokeDecoder:
    """Decode complete array elements as soon as they arrive in streamed JSON."""
    def __init__(self): self.buffer=""; self.started=False; self.count=0; self.seen=set()
    def feed(self,text):
        self.buffer+=text
        if len(self.buffer)>1_000_000: raise ValueError("Canvas response exceeds limit.")
        if not self.started:
            match=re.search(r'"strokes"\s*:\s*\[',self.buffer)
            if not match:return []
            self.buffer=self.buffer[match.end():];self.started=True
        results=[]
        while True:
            self.buffer=self.buffer.lstrip(" \r\n\t,")
            if not self.buffer or self.buffer.startswith("]"):break
            try:value,end=json.JSONDecoder().raw_decode(self.buffer)
            except json.JSONDecodeError:break
            self.buffer=self.buffer[end:];stroke=validate_stroke(value);self.count+=1
            if self.count>24 or stroke["id"] in self.seen: raise ValueError("Too many or duplicate canvas strokes.")
            self.seen.add(stroke["id"]);results.append(stroke)
        return results

def stream_strokes(key,model,payload):
    parts=[{"text":json.dumps({name:payload.get(name) for name in ["intent","narration","board"]})}]
    image=payload.get("image")
    if image:parts.append({"inlineData":{"mimeType":"image/png","data":image}})
    stroke_schema={"type":"object","required":["id","type","onsetOffsetMs","durationMs","points"],"properties":{
        "id":{"type":"string"},"type":{"type":"string","enum":["freedraw","text","primitive"]},
        "onsetOffsetMs":{"type":"number"},"durationMs":{"type":"number"},
        "points":{"type":"array","items":{"type":"object","required":["x","y"],"properties":{"x":{"type":"number"},"y":{"type":"number"}}}},
        "text":{"type":"string"},"math":{"type":"boolean"},"color":{"type":"string"},"width":{"type":"number"}}}
    body={"systemInstruction":{"parts":[{"text":DRAWING_CONTRACT}]},"contents":[{"role":"user","parts":parts}],
          "generationConfig":{"responseMimeType":"application/json","maxOutputTokens":7000,
           "responseJsonSchema":{"type":"object","required":["strokes"],"properties":{"strokes":{"type":"array","items":stroke_schema}}}}}
    request=urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse",
        data=json.dumps(body).encode(),headers={"x-goog-api-key":key,"Content-Type":"application/json"})
    decoder=StrokeDecoder();total=0
    with urllib.request.urlopen(request,timeout=30) as response:
        for line in response:
            total+=len(line)
            if total>2_000_000: raise ValueError("Canvas stream exceeds limit.")
            if not line.startswith(b"data:"):continue
            data=line[5:].strip()
            if data==b"[DONE]":break
            event=json.loads(data)
            if event.get("error"):raise ValueError("Canvas provider returned an error.")
            for candidate in event.get("candidates",[]):
                for part in candidate.get("content",{}).get("parts",[]):
                    if part.get("thought"):continue
                    for stroke in decoder.feed(part.get("text","")):yield stroke
    if not decoder.count:raise ValueError("Canvas specialist returned no valid strokes.")
