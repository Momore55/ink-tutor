import unittest
from canvas_agent import StrokeDecoder, validate_stroke
import json
import os
import threading
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from voice_server import Handler

class CanvasTests(unittest.TestCase):
    def stroke(self):return {"id":"curve","type":"freedraw","onsetOffsetMs":100,"durationMs":900,"points":[{"x":30,"y":40},{"x":90,"y":120}]}
    def test_incremental_json(self):
        import json
        text=json.dumps({"strokes":[self.stroke()]});decoder=StrokeDecoder();results=[]
        for char in text:results.extend(decoder.feed(char))
        self.assertEqual(len(results),1);self.assertEqual(results[0]["id"],"curve")
    def test_rejects_invalid_geometry(self):
        value=self.stroke();value["points"][0]["x"]=float('nan')
        with self.assertRaises(ValueError):validate_stroke(value)
    def test_rejects_duplicates(self):
        import json
        with self.assertRaises(ValueError):StrokeDecoder().feed(json.dumps({"strokes":[self.stroke(),self.stroke()]}))
    def test_text_keeps_markup_as_data(self):
        value={**self.stroke(),"type":"text","text":"<script>bad()</script>","math":False}
        self.assertEqual(validate_stroke(value)["text"],value["text"])

class CanvasRouteTests(unittest.TestCase):
    def setUp(self):
        class QuietHandler(Handler):
            def log_message(self,*args):pass
        self.server=ThreadingHTTPServer(('127.0.0.1',0),QuietHandler)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
    def tearDown(self):self.server.shutdown();self.server.server_close();self.thread.join()
    def request(self,payload,origin='http://127.0.0.1:7860'):
        return urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{self.server.server_port}/canvas-actions',
            data=json.dumps(payload).encode(),headers={'Host':'127.0.0.1:7860','Origin':origin,'Content-Type':'application/json'}),timeout=3)
    def test_stream_route_delivers_strokes_and_completion(self):
        stroke=validate_stroke(CanvasTests().stroke())
        with patch.dict(os.environ,{'GEMINI_API_KEY':'synthetic-test-only'}),patch('voice_server.stream_strokes',return_value=iter([stroke])):
            with self.request({'intent':'a curve','narration':'describe a curve','board':[]}) as response:
                self.assertEqual(response.headers['Content-Type'],'application/x-ndjson')
                events=[json.loads(line) for line in response]
        self.assertEqual([event['type'] for event in events],['stroke','done'])
    def test_foreign_origin_is_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as error:self.request({},'https://other.example')
        self.assertEqual(error.exception.code,403)
        error.exception.close()
    def test_invalid_canvas_request_is_rejected(self):
        with patch.dict(os.environ,{'GEMINI_API_KEY':'synthetic-test-only'}):
            with self.assertRaises(urllib.error.HTTPError) as error:self.request({'intent':'a curve','narration':''})
        self.assertEqual(error.exception.code,400)
        error.exception.close()
    def test_provider_failure_keeps_the_stream_explicit(self):
        with patch.dict(os.environ,{'GEMINI_API_KEY':'synthetic-test-only'}),patch('voice_server.stream_strokes',side_effect=ValueError('bad provider response')):
            with self.request({'intent':'a curve','narration':'describe a curve'}) as response:
                event=json.loads(response.readline())
        self.assertEqual(event['type'],'error')

if __name__=='__main__':unittest.main()
