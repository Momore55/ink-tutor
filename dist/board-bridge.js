/* Deterministic SVG geometry. No provider fields or audio clocks enter the renderer. */
(function (root) {
  const NS = 'http://www.w3.org/2000/svg';
  const node = (tag, attributes = {}) => {
    const element = document.createElementNS(NS, tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    return element;
  };
  class Scene {
    constructor(ink, board, pen, glyphs, layout) {
      Object.assign(this, { ink, board, pen, glyphs, layout });
      this.objects = new Map();
      this.maxObjects = 32;
      this.clipId = 0;
    }
    target(id, generation) { return this.objects.get(id) || this.objects.get(generation + ':' + id); }
    prepare(action, generation) {
      const kinds = ['write_math','write_text','highlight','circle','draw_line','erase','freedraw'];
      if (!kinds.includes(action.kind)) throw Error('Unsupported board operation.');
      if (typeof action.targetId !== 'string' || !/^[a-zA-Z0-9_:-]{1,120}$/.test(action.targetId)) throw Error('Supply a short targetId.');
      if (action.anchor && (typeof action.anchor.phrase !== 'string' || action.anchor.phrase.length > 180 ||
        !Number.isInteger(action.anchor.occurrence) || action.anchor.occurrence < 1 || action.anchor.occurrence > 20)) throw Error('Invalid phrase anchor.');
      if (['circle','highlight','erase'].includes(action.kind)) return this.decorate(action, generation);
      const id = generation + ':' + action.targetId;
      if (this.objects.has(id)) throw Error('Target already exists. Use another targetId.');
      if (this.objects.size >= this.maxObjects) throw Error('Board is full. Erase an existing object first.');
      let layout;
      if (!['draw_line','freedraw'].includes(action.kind)) {
        if (typeof action.content !== 'string' || !action.content.trim() || action.content.length > 240) throw Error('Use content of at most 240 characters.');
        layout = action.kind === 'write_math' ? this.layout(action.content) : {
          width: action.content.length,
          marks: Array.from(action.content, (char, index) => ({ char, x: index, y: 0, scale: 1 })),
        };
        if (layout.marks.length > 240) throw Error('Expression has too many marks.');
      }
      const rowSlots = [...this.objects.values()].filter(object => object.slot !== null).map(object => object.slot);
      let slot = null;
      if (!['draw_line','freedraw'].includes(action.kind) && action.x === undefined && action.y === undefined) {
        slot = Array.from({length:8}, (_,i)=>i).find(i=>!rowSlots.includes(i));
        if (slot === undefined) throw Error('All eight writing rows are occupied. Erase a row before writing more.');
      }
      const x = action.x ?? 70, y = action.y ?? (54 + (slot || 0) * 66);
      this.coordinate(x, y);
      if (action.kind === 'draw_line') this.coordinate(action.toX, action.toY);
      const group = node('g', { 'data-target-id': id, 'aria-label': action.content || action.kind });
      const object = { id, content: action.content || '', kind: action.kind, group, slot, progress: 0,
        position: {x,y,...(action.kind==='draw_line'?{toX:action.toX,toY:action.toY}:{})},
        status: 'prepared', marks: [], decorations: [] };
      const strokes = [];
      if(action.kind==='freedraw'){
        const stroke=InkStroke.validate({id:'geometry',type:'freedraw',onsetOffsetMs:0,durationMs:100,points:action.points,color:action.color,width:action.width});
        if(root.InkUserBoardScene){
          const renderer=new root.InkUserBoardScene(this.board,{strokeColor:stroke.color,strokeWidth:stroke.width});
          const id='vector_'+(++this.clipId);renderer.svgGroup.setAttribute('id',id);group.append(renderer.svgGroup);
          const measure=node('path',{d:renderer._generateSplinePath(stroke.points)});
          const length=measure.getTotalLength();let visible;
          strokes.push({length:Math.max(1,length),get element(){return visible||measure;},
            reveal:progress=>{
              if(progress<=0&&!visible)return;
              const index=progress*(stroke.points.length-1),left=Math.floor(index),right=Math.min(stroke.points.length-1,left+1),fraction=index-left;
              const point={x:stroke.points[left].x+(stroke.points[right].x-stroke.points[left].x)*fraction,y:stroke.points[left].y+(stroke.points[right].y-stroke.points[left].y)*fraction};
              renderer.renderStrokeProgress(id,progress,point,stroke.points);
              visible=renderer.activeStrokes.get(id)?.pathElement||visible;
              if(progress===1)renderer.markStrokeFinished(id);
            },point:progress=>measure.getPointAtLength(length*progress)});
        }else{
          this.path(group,stroke.points.map((point,i)=>(i?'L':'M')+point.x+' '+point.y).join(' '),strokes);
          for(const path of group.querySelectorAll('path')){path.setAttribute('stroke',stroke.color);path.setAttribute('stroke-width',stroke.width);}
        }
      }else if (action.kind === 'draw_line') {
        this.path(group, 'M' + x + ' ' + y + ' L' + action.toX + ' ' + action.toY, strokes);
      } else {
        const top = Math.min(0, ...layout.marks.map(mark => mark.y * 29 - 4 * mark.scale));
        const bottom = Math.max(40, ...layout.marks.map(mark => mark.y * 29 + 40 * mark.scale));
        const scale = Math.min(1.5, (880 - x) / (layout.width * 29), 62 / (bottom - top));
        if (scale <= 0.08 || y + (bottom - top) * scale > 615) throw Error('Writing does not fit on the board.');
        for (const mark of layout.marks) {
          const glyph = node('g', { transform: 'translate(' + (x + mark.x * 29 * scale) + ' ' +
            (y + (mark.y * 29 - top) * scale) + ') scale(' + scale * mark.scale + ')' });
          group.append(glyph);
          const shapes = mark.char === 'bar' ? ['M2 12 H' + (mark.width * 29 - 2)]
            : mark.char === '∑' ? ['M23 2 L3 2 L15 15 L3 29 L24 29'] : this.glyphs[mark.char];
          if (shapes) for (const shape of shapes) this.path(glyph, shape, strokes, scale * mark.scale);
          else if (mark.char !== ' ') this.text(glyph, mark.char, strokes);
          object.marks.push(glyph);
        }
      }
      this.ink.append(group);
      this.objects.set(id, object);
      return this.handle(object, strokes);
    }
    coordinate(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 10 || x > 880 || y < 10 || y > 610) throw Error('Coordinates must stay inside the 900 by 620 board.');
    }
    path(group, d, strokes, scale = 1) {
      const path = node('path', { d, fill:'none', stroke:'#eeeedd', 'stroke-width':2.2,
        'stroke-linecap':'round', 'stroke-linejoin':'round' });
      group.append(path);
      const length = path.getTotalLength();
      path.style.strokeDasharray = length;
      path.style.strokeDashoffset = length;
      strokes.push({ element:path, length:Math.max(1, length * scale),
        reveal:f=>{path.style.strokeDashoffset = length * (1-f);}, point:f=>path.getPointAtLength(length*f) });
    }
    text(group, char, strokes) {
      const text = node('text', { y:27, 'font-size':29, fill:'#eeeedd', stroke:'none' });
      text.textContent = char;
      const clip = node('clipPath', { id:'sync-clip-' + (++this.clipId) });
      const area = node('rect', { x:-3, y:-8, height:50, width:0 });
      clip.append(area); group.append(clip, text);
      text.setAttribute('clip-path', 'url(#' + clip.id + ')');
      strokes.push({ element:text, length:28, reveal:f=>area.setAttribute('width',34*f), point:f=>({x:28*f,y:18}) });
    }
    handle(object, strokes, parent) {
      const total = strokes.reduce((sum,stroke)=>sum+stroke.length,0);
      const render = progress => {
        object.progress = progress;
        object.status = progress === 1 ? 'completed' : 'started';
        let distance = total * progress;
        let active;
        for (const stroke of strokes) {
          const fraction = Math.max(0,Math.min(1,distance/stroke.length));
          stroke.reveal(fraction);
          if (fraction > 0 && fraction < 1) active = {stroke,fraction};
          distance -= stroke.length;
        }
        if (active) {
          const point = active.stroke.point(active.fraction);
          const matrix = this.board.getCTM()?.inverse().multiply(active.stroke.element.getCTM());
          if (matrix) {
            const position = new DOMPoint(point.x, point.y).matrixTransform(matrix);
            this.pen.setAttribute('transform','translate(' + position.x + ' ' + position.y + ')');
            this.pen.style.display='block';
          }
        }
        if (progress === 1) this.pen.style.display='none';
      };
      return { targetId:object.id, duration:Math.max(0.5, total/230), render, available:()=>object.group.isConnected,
        cancel:progress=>{
          object.status='cancelled'; object.progress=progress;
          if (!progress) {
            object.group.remove();
            if (parent) parent.decorations = parent.decorations.filter(item=>item!==object);
            else this.objects.delete(object.id);
          }
          this.pen.style.display='none';
        } };
    }
    decorate(action, generation) {
      const target = this.target(action.targetId, generation);
      if (!target || (target.progress <= 0 && target.status!=='prepared')) throw Error('Target is not available. Get board state first.');
      if (action.kind === 'erase') {
        const initial = Number(target.group.getAttribute('opacity') ?? 1);
        return {targetId:target.id,duration:0.5,
          render:progress=>{
            target.group.setAttribute('opacity',initial*(1-progress));
            target.erased = progress;
            if (progress===1) { target.group.remove(); this.objects.delete(target.id); }
          }, cancel:()=>{} };
      }
      if (target.decorations.length >= 8) throw Error('Too many decorations on this target.');
      let bounds = target.group.getBBox();
      if (action.term) {
        if (typeof action.term !== 'string' || action.term.length > 80 || /[\\^_\/{}]/.test(target.content)) throw Error('Term targeting needs plain notation. Omit term to use the whole target.');
        const start = target.content.indexOf(action.term);
        if (start < 0) throw Error('Term not found.');
        const boxes = target.marks.slice(start,start+action.term.length).map(element=>{
          const box=element.getBBox(), matrix=element.transform.baseVal.consolidate().matrix;
          return { x:matrix.e+box.x*matrix.a,y:matrix.f+box.y*matrix.d,width:box.width*matrix.a,height:box.height*matrix.d };
        });
        const left=Math.min(...boxes.map(box=>box.x)), top=Math.min(...boxes.map(box=>box.y));
        bounds={x:left,y:top,width:Math.max(...boxes.map(box=>box.x+box.width))-left,height:Math.max(...boxes.map(box=>box.y+box.height))-top};
      }
      const x=bounds.x-6,y=bounds.y-6,w=bounds.width+12,h=bounds.height+12;
      const d = action.kind==='highlight' ? 'M'+x+' '+(y+h)+' h'+w
        : 'M'+(x+w/2)+' '+y+' C'+(x+w*1.2)+' '+y+' '+(x+w*1.2)+' '+(y+h)+' '+(x+w/2)+' '+(y+h)+' C'+(x-w*.2)+' '+(y+h)+' '+(x-w*.2)+' '+y+' '+(x+w/2)+' '+y;
      const group=node('g');target.group.append(group);
      const decoration={id:target.id,group,kind:action.kind,term:action.term||null,progress:0,status:'prepared'};
      const strokes=[];this.path(group,d,strokes);
      strokes[0].element.setAttribute('stroke','#eec57e');
      target.decorations.push(decoration);
      return this.handle(decoration,strokes,target);
    }
    discardTargets(ids){
      for(const id of ids){const object=this.objects.get(id);if(object){object.group.remove();this.objects.delete(id);}}
      this.pen.style.display='none';
    }
    snapshot() {
      return [...this.objects.values()].filter(object=>object.progress>0).map(object=>({
        targetId:object.id,kind:object.kind,content:object.content,status:object.status,position:object.position,
        progress:Math.round(object.progress*1000)/1000,...(object.erased?{erased:object.erased}:{}),
        marks:object.decorations.filter(item=>item.progress>0).map(item=>({kind:item.kind,term:item.term,status:item.status,progress:item.progress})),
      }));
    }
  }
  root.InkBoard = { Scene };
})(globalThis);
