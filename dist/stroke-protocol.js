/* Timestamped vector data only. This parser never executes model code. */
(function(root){
  function validate(stroke){
    if(!stroke||typeof stroke!=='object')throw Error('Supply a scheduled stroke object.');
    const {id,type,onsetOffsetMs,durationMs,points,text,color='#eeeedd',width=3}=stroke;
    if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(id))throw Error('Invalid stroke id.');
    if(!['freedraw','text','primitive'].includes(type))throw Error('Unsupported stroke type.');
    if(!Number.isFinite(onsetOffsetMs)||onsetOffsetMs<0||onsetOffsetMs>60000||!Number.isFinite(durationMs)||durationMs<16||durationMs>60000)throw Error('Stroke timing is outside the one-minute window.');
    if(!Array.isArray(points)||points.length<(type==='text'?1:2)||points.length>1024)throw Error('Supply bounded vector points.');
    const clean=points.map(point=>{
      const x=Array.isArray(point)?point[0]:point?.x,y=Array.isArray(point)?point[1]:point?.y;
      if(!Number.isFinite(x)||!Number.isFinite(y)||x<10||x>880||y<10||y>610)throw Error('Vector point is outside the board.');
      return {x,y};
    });
    if(!/^#[\da-fA-F]{6}$/.test(color)||!Number.isFinite(width)||width<.5||width>12)throw Error('Invalid pen appearance.');
    if(type==='text'&&(typeof text!=='string'||!text.trim()||text.length>240))throw Error('Invalid stroke text.');
    return {id,type,onsetOffsetMs,durationMs,points:clean,color,width,...(type==='text'?{text,math:stroke.math===true}:{})};
  }
  function action(raw){
    const stroke=validate(raw),point=stroke.points[0];
    return {actionId:stroke.id,targetId:stroke.id,kind:stroke.type==='text'?(stroke.math?'write_math':'write_text'):'freedraw',
      onsetOffsetMs:stroke.onsetOffsetMs,durationMs:stroke.durationMs,color:stroke.color,width:stroke.width,
      ...(stroke.type==='text'?{content:stroke.text,x:point.x,y:point.y}:{points:stroke.points})};
  }
  function parse(serialized,options){
    if(typeof serialized!=='string'||serialized.length>24000)throw Error('Invalid serialized stroke.');
    const [type,onset,...coordinates]=serialized.split('|').map(part=>part.trim());
    if(!['FREEDRAW','TEXT','PRIMITIVE'].includes(type)||!/^\d+(?:\.\d+)?$/.test(onset))throw Error('Invalid stroke serialization.');
    if(type==='TEXT'){
      if(coordinates.length!==2)throw Error('TEXT needs one point and a JSON text string.');
      return validate({...options,type:'text',onsetOffsetMs:Number(onset),points:[coordinates[0].split(',').map(Number)],text:JSON.parse(coordinates[1])});
    }
    return validate({...options,type:type.toLowerCase(),onsetOffsetMs:Number(onset),points:coordinates.map(point=>point.split(',').map(Number))});
  }
  root.InkStroke={validate,action,parse};
})(globalThis);
