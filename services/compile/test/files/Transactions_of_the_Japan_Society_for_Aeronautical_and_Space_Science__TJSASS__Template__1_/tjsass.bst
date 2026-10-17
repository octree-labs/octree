%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
%    Transaction of JSASS bibliography style 
%    numeric labels, order-of-reference, 
%    authors: article titles, commas separate all fields
%    [journal abbreviations in italic, volume number in bold (year),
%    pp. pages] 
%    except before "notes".  
%    History:
%     19-Aug-2025 H. Kojima (TMU) (first creation) 
%     29-Sep-2025 List abbreviation of Journal names and authomatic replacement code
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%

FUNCTION {space.word}
{ " " swap$ * " " * }

FUNCTION {bbl.and}
{ "and"}

FUNCTION {bold}
{ duplicate$ empty$
    { pop$ "" }
    { "{\bfseries " swap$ * "}" * }
  if$
}

FUNCTION {parenthesis}
{ duplicate$ empty$
    { pop$ "" }
    { "(" swap$ * ")" * }
  if$
}


%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
ENTRY
  { address
    author
    booktitle
    chapter
    edition
    editor
    howpublished
    institution
    journal
    key
    month
    note
    number
    issue
    organization
    pages
    publisher
    school
    series
    title
    type
    volume
    year
    url
  }
  {}
  { label }

INTEGERS { output.state before.all mid.sentence after.quote after.sentence
		after.quoted.block after.block author.quote }

FUNCTION {init.state.consts}
{ #0 'before.all :=
  #1 'mid.sentence :=
  #2 'after.quote :=
  #3 'after.sentence :=
  #4 'after.quoted.block :=
  #5 'after.block :=
  #6 'author.quote :=
}

STRINGS { s t }

FUNCTION {output.nonnull}
{ 's :=
  output.state mid.sentence =
    { ", " * write$ }
    { output.state after.quote =
	{ " " * write$ }
    { output.state author.quote =
	{ ": " * write$ }
	{ output.state after.block =
	    { add.period$ write$
	      newline$
	      "\newblock " write$
	    }
	    { output.state before.all =
		'write$
		{ output.state after.quoted.block =
		    { write$
		      newline$
		      "\newblock " write$
		    }
		    { add.period$ " " * write$ }
		  if$
		}
	      if$
	    }
	  if$
	}
    if$
    }
      if$
      mid.sentence 'output.state :=
    }
  if$
  s
}

FUNCTION {output}
{ duplicate$ empty$
    'pop$
    'output.nonnull
  if$
}

FUNCTION {output.check}
{ 't :=
  duplicate$ empty$
    { pop$ "empty " t * " in " * cite$ * warning$ }
    'output.nonnull
  if$
}

FUNCTION {output.bibitem}
{ newline$
  "\bibitem{" write$
  cite$ write$
  "}" write$
  newline$
  ""
  before.all 'output.state :=
}

FUNCTION {blank.sep}
{ after.quote 'output.state :=
}

FUNCTION {col.sep}
{ author.quote 'output.state :=
}

FUNCTION {comma.sep}
{ ", " write$ }

FUNCTION {fin.entry}
{ output.state after.quoted.block =
    'skip$
    'add.period$
  if$
  write$
  newline$
}

FUNCTION {new.block}
{ output.state before.all =
    'skip$
    { output.state after.quote =
	{ after.quoted.block 'output.state := }
	{ after.block 'output.state := }
      if$
    }
  if$
}

FUNCTION {new.sentence}
{ output.state after.block =
    'skip$
    { output.state before.all =
	'skip$
	{ after.sentence 'output.state := }
      if$
    }
  if$
}

FUNCTION {not}
{   { #0 }
    { #1 }
  if$
}

FUNCTION {and}
{   'skip$
    { pop$ #0 }
  if$
}

FUNCTION {or}
{   { pop$ #1 }
    'skip$
  if$
}

FUNCTION {new.block.checka}
{ empty$
    'skip$
    'new.block
  if$
}

FUNCTION {new.block.checkb}
{ empty$
  swap$ empty$
  and
    'skip$
    'new.block
  if$
}

FUNCTION {new.sentence.checka}
{ empty$
    'skip$
    'new.sentence
  if$
}

FUNCTION {field.or.null}
{ duplicate$ empty$
    { pop$ "" }
    'skip$
  if$
}

FUNCTION {emphasize}
{ duplicate$ empty$
    { pop$ "" }
    { "{\em " swap$ * "}" * }
  if$
}

INTEGERS { nameptr namesleft numnames }

FUNCTION {bbl.etal}
{ "et~al" }

STRINGS  { bibinfo}

FUNCTION {bibinfo.check}
{ swap$
  duplicate$ missing$
    {
      pop$ pop$
      ""
    }
    { duplicate$ empty$
        {
          swap$ pop$
        }
        { swap$
          pop$
        }
      if$
    }
  if$
}

FUNCTION {format.names.f}
{ 's :=
  #1 'nameptr :=
  s num.names$ 'numnames :=
  numnames 'namesleft :=
    { namesleft #0 > }
    { s nameptr
      "{vv~}{ll}{, jj}{, f.}" format.name$ 't :=
      %%-- start-- (if 参考文献著者を5人までに限定する場合）
      nameptr #6 =
        { "others" 't :=
          #1 'namesleft :=
        }
        'skip$
      if$
      %%-- end ---
      nameptr #1 >
        {
          namesleft #1 >
            { ", " * t * }
            {
              t "others" =
                { " et~al." * }
                { numnames #2 >
                    { ", " * }
                    'skip$
                  if$
                  bbl.and space.word * t * }
              if$
            }
          if$
        }
        't
      if$
      nameptr #1 + 'nameptr :=
      namesleft #1 - 'namesleft :=
    }
  while$
}

FUNCTION {format.names}
{ 's :=
  #1 'nameptr :=
  s num.names$ 'numnames :=
  numnames 'namesleft :=
    { namesleft #0 > }
    { s nameptr
      "{vv~}{ll}{, jj}{, f.}" format.name$ 't :=

      nameptr #1 >
        {
          namesleft #1 >
            { ", " * t * }
            {
              numnames #2 >
                { "," * }
                'skip$
              if$
              t "others" =
                { " et~al." * }
                { bbl.and space.word * t * 
                }
              if$
            }
          if$
        }
        't
      if$
      nameptr #1 + 'nameptr :=
      namesleft #1 - 'namesleft :=
    }
  while$
}

STRINGS {word char captitle}
INTEGERS {firstword notspace notlastchar wl }

FUNCTION {uppercase.word}
{
  't :=
  t empty$
    { "" }
    {
      t
      % 先頭1テキスト文字だけ取り出して大文字化
      duplicate$ #1 text.prefix$ "u" change.case$   % tlower  ->  tlower  UFirst

      % 残り（2文字目以降）を取り出す (2文字目が""nullなら""がpushされる）
      swap$ #2 global.max$ substring$               % UFirst  Rest

      % 連結
      *
    }
  if$
}

FUNCTION {lowercase.word}
{  "l" change.case$
}

FUNCTION {is.preposition}
{
  't :=
  t "l" change.case$ 't :=
  t "a" = 
  t "above" = or
  t "across" = or
  t "an" = or
  t "and" = or
  t "about" = or
  t "after" = or
  t "against" = or
  t "along" = or
  t "among" = or
  t "around" = or
  t "as" = or
  t "at" = or
  t "by" = or
  t "before" = or
  t "behind" = or
  t "below" = or
  t "beneath" = or
  t "beside" = or
  t "besides" = or
  t "between" = or
  t "beyond" = or
  t "down" = or
  t "during" = or
  t "except" = or
  t "in" = or
  t "inside" = or
  t "for" = or
  t "from" = or
  t "into" = or
  t "minus" = or
  t "near" = or
  t "of" = or
  t "off" = or
  t "on" = or
  t "onto" = or
  t "opposite" = or
  t "out" = or
  t "outside" = or
  t "over" = or
  t "or" = or
  t "per" = or
  t "plus" = or
  t "round" = or
  t "since" = or
  t "than" = or
  t "through" = or
  t "throughout" = or
  t "the" = or
  t "till" = or
  t "to" = or
  t "toward" = or
  t "towards" = or
  t "under" = or
  t "until" = or
  t "up" = or
  t "upon" = or
  t "with" = or
  t "within" = or
  t "without" = or
  t "versus" = or
  t "via" = or
}

FUNCTION {title.capitalize} 
{
  's :=
  "" 'captitle :=
  #1 'firstword :=
  #1 'notlastchar :=
  #1 'notspace :=
  
  {s empty$ not notlastchar and} % 条件
  {  
    "" 'word :=
    #1 'notspace :=
   
    { s empty$ not notspace and}
    {
       s text.length$ 'wl :=
       wl #1 =
       { s #1 #1 substring$ 'char :=
         word char * 'word :=
         #0 'notspace :=
         #0 'notlastchar :=
       }
       { s #1 #1 substring$ 'char :=
         char " " =
          { #0 'notspace :=  }
          { word char * 'word := }
          if$
          s #2 global.max$ substring$ 's :=   
       }
       if$
    } while$

    firstword #1 =  % １単語目処理実行開始
    {  word uppercase.word 'word := 
       captitle word * 'captitle := 
       #0 'firstword :=
    }
    { % 2単語目以降
       word is.preposition
         { word lowercase.word 'word := } % 前置詞なら小文字化（全体をlowercase）
         { word uppercase.word 'word := } % 前置詞でなければ１文字目のみ大文字化
       if$
       captitle " " * word * 'captitle := 
    }
    if$ % 2単語目以降終了
    
  } while$  % タイトル処理実行終わり
  captitle
}

FUNCTION {format.authors}
{ author empty$
    { "\textcolor{red}{author missing}" }
    { author format.names.f }
  if$
}

FUNCTION {format.title}
{ title empty$
    { "\textcolor{red}{title missing}" }
    { title title.capitalize }
    %{ title }
  if$
}

FUNCTION {format.editors}
{ editor empty$
    { "" }
    { editor format.names.f
      editor num.names$ #1 >
	{ ", eds." * }
	{ ", ed." * }
      if$
    }
  if$
}

FUNCTION {format.title.p}
{ title empty$
    { "" }
    { title
      ":\/{\em " *
        { "\/}" * }
        { "\/}" * }
      if$
    }
  if$
}

FUNCTION {n.dashify}
{ 't :=
  ""
    { t empty$ not }
    { t #1 #1 substring$ "-" =
	{ t #1 #2 substring$ "--" = not
	    { "--" *
	      t #2 global.max$ substring$ 't :=
	    }
	    {   { t #1 #1 substring$ "-" = }
		{ "-" *
		  t #2 global.max$ substring$ 't :=
		}
	      while$
	    }
	  if$
	}
	{ t #1 #1 substring$ *
	  t #2 global.max$ substring$ 't :=
	}
      if$
    }
  while$
}

FUNCTION {get.issue}
{ number empty$
    { issue }
    { number }
  if$
}

FUNCTION {format.date}
{ year empty$
    { month empty$
	{ "\textcolor{red}{year missing}" }
	{ "there's a month but no year in " cite$ * warning$
	  month
	}
      if$
    }
    { month empty$
	'year
	{ month " " * year * }
      if$
    }
  if$
}

FUNCTION {format.btitle}
{ booktitle empty$
  {"\textcolor{red}{booktitle missing}"}
  {booktitle title.capitalize}
  if$
}


FUNCTION {format.url}
{ url empty$
    {  }
    %{ url * " "}
    { "\url{" url * "}" * }
  if$
}

FUNCTION {format.note}
{ note empty$
    'skip$
    { " " * note *}
  if$
}

FUNCTION {tie.or.space.connect}
{ duplicate$ text.length$ #3 <
    { "~" }
    { " " }
  if$
  swap$ * *
}

FUNCTION {either.or.check}
{ empty$
    'pop$
    { "can't use both " swap$ * " fields in " * cite$ * warning$ }
  if$
}

FUNCTION {format.bvolume}
{ volume empty$
    { "" }
    { "vol.~" volume *
      series empty$
	'skip$
	{ " of " * series emphasize * }
      if$
      "volume and number" number either.or.check
    }
  if$
}

FUNCTION {format.number.series}
{ volume empty$
    { number empty$
	{ series field.or.null }
	{ output.state mid.sentence =
	    { "no.~" }
	    { "No.~" }
	  if$
	  number *
	  series empty$
	    { "there's a number but no series in " cite$ * warning$ }
	    { " in " * series * }
	  if$
	}
      if$
    }
    { "" }
  if$
}

FUNCTION {format.edition}
{ edition empty$
    { "" }
    { edition "l" change.case$ "~ed." * }
  if$
}

INTEGERS { multiresult }

FUNCTION {multi.page.check}
{ 't :=
  #0 'multiresult :=
    { multiresult not
      t empty$ not
      and
    }
    { t #1 #1 substring$
      duplicate$ "-" =
      swap$ duplicate$ "," =
      swap$ "+" =
      or or
	{ #1 'multiresult := }
	{ t #2 global.max$ substring$ 't := }
      if$
    }
  while$
  multiresult
}

FUNCTION {format.pages}
{ pages empty$
    'skip$
    { pages multi.page.check
	{ "pp.~" pages n.dashify * }
        { "" pages * }
	%{ "p.~" pages * }
      if$
    }
  if$
}


FUNCTION {format.volume}
{ volume empty$
    { "\textcolor{red}{volume missing}" }
    { volume bold }
  if$
}

FUNCTION {format.number}
{ number empty$
    { "\textcolor{red}{ number missing}" }
    { number }
  if$
}

FUNCTION {format.aiaapapernumber}
{ number empty$
    { "\textcolor{red}{number missing}" }
    { "AIAA-Paper " number * }
  if$
}

FUNCTION {format.chapter.pages}
{ chapter empty$
    'format.pages
    { type empty$
	{ "Chapter~" chapter * }
	{ type "l" change.case$ chapter tie.or.space.connect }
      if$
      pages empty$
	'skip$
	{ ", " * format.pages * }
      if$
    }
  if$
}

%FUNCTION {format.in.ed.booktitle}
%{ booktitle empty$
%    { "empty booktitle in " cite$ * warning$ "" }
%    { booktitle emphasize 
%      editor empty$
%	    'skip$
%	   { ", " * format.editors *}
%      if$
%    }
%  if$
%}

FUNCTION {format.in.ed.booktitle}
{ editor empty$
  {  booktitle empty$
       { "\textcolor{red}{title missing}" }
       { booktitle title.capitalize emphasize }
     if$ 
   }
   { 
     format.editors 
     booktitle empty$
       { "\textcolor{red}{title missing}" }
       { booktitle title.capitalize emphasize }
     if$
  }
  if$
}

FUNCTION {format.thesis.type}
{ type empty$
    'skip$
    { pop$
      output.state after.block =
	{ type "t" change.case$ }
	{ type "l" change.case$ }
      if$
    }
  if$
}

FUNCTION {empty.misc.check}
{ author empty$ title empty$ howpublished empty$
  month empty$ year empty$ note empty$
  and and and and and
    { "all relevant fields are empty in " cite$ * warning$ }
    'skip$
  if$
}

FUNCTION {format.tr.number}
{ type empty$
    { "" }
    'type
  if$
  number empty$
    { "l" change.case$ }
    { number tie.or.space.connect }
  if$
}

FUNCTION {format.pub.addr}
{ publisher empty$
    { "publisher name is missing" 
      address empty$
        { "\textcolor{red}{address missing}" }
        { ", " * address * }
      if$
    }
    { publisher  
      address empty$
        { "\textcolor{red}{address missing}" output}
        { ", " * address * }
      if$
    }
  if$
}

FUNCTION {format.publisher}
{ publisher empty$
    { "\textcolor{red}{publisher missing}" }
    { publisher }
    if$
}

FUNCTION {format.address}
{ address empty$
    { "\textcolor{red}{address missing}" }
    { address }
    if$
}

FUNCTION {format.paddress}
{ address empty$
    { "" }
    { "(" address * ")" * }
  if$
}

FUNCTION {format.article.crossref}
{ key empty$
    { journal empty$
	{ "need key or journal for " cite$ * " to crossref " * crossref *
	  warning$
	  ""
	}
	{ "in {\em " journal * "\/}" * }
      if$
    }
    { "in " key * }
  if$
  " \cite{" * crossref * "}" *
}

FUNCTION {format.crossref.editor}
{ editor #1 "{vv~}{ll}" format.name$
  editor num.names$ duplicate$
  #2 >
    { pop$ " et~al." * }
    { #2 <
	'skip$
	{ editor #2 "{ff }{vv }{ll}{ jj}" format.name$ "others" =
	    { " et~al." * }
	    { " and " * editor #2 "{vv~}{ll}" format.name$ * }
	  if$
	}
      if$
    }
  if$
}

FUNCTION {format.book.date.note}
{ year empty$
    { "" }
    { year
      note empty$
        { "" }
        { note output}
      if$
     }
    if$
   new.block
}

FUNCTION {format.book.crossref}
{ volume empty$
    { "empty volume in " cite$ * "'s crossref of " * crossref * warning$
      ""
    }
    { "Vol.~" volume *
      " of " *
    }
  if$
  editor empty$
  editor field.or.null author field.or.null =
  or
    { key empty$
	{ series empty$
	    { "need editor, key, or series for " cite$ * " to crossref " *
	      crossref * warning$
	      "" *
	    }
	    { "{\em " * series * "\/}" * }
	  if$
	}
	{ key * }
      if$
    }
    { format.crossref.editor * }
  if$
  " \cite{" * crossref * "}" *
}

FUNCTION {format.incoll.inproc.crossref}
{ editor empty$
  editor field.or.null author field.or.null =
  or
    { key empty$
	{ booktitle empty$
	    { "need editor, key, or booktitle for " cite$ * " to crossref " *
	      crossref * warning$
	      ""
	    }
	    { "{\em " booktitle * "\/}" * }
	  if$
	}
	{ "in " key * }
      if$
    }
    { format.crossref.editor * }
  if$
  " \cite{" * crossref * "}" *
}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% Journal name abbreviation
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
MACRO {acmcs} {"ACM Computing Surveys"}

MACRO {acta} {"Acta Informatica"}

MACRO {cacm} {"Communications ACM"}

MACRO {ibmjrd} {"IBM J. Research and Development"}

MACRO {ibmsj} {"IBM Systems~J."}

MACRO {ieeese} {"IEEE Trans. Software Engineering"}

MACRO {ieeetc} {"IEEE Trans. Computers"}

MACRO {ieeetcad} {"IEEE Trans. Computer-Aided Design"}

MACRO {ipl} {"Information Processing Letters"}

MACRO {jacm} {"J.~ACM"}

MACRO {jcss} {"J.~Computer and System Sciences"}

MACRO {scp} {"Science of Computer Programming"}

MACRO {sicomp} {"SIAM J. Computing"}

MACRO {tocs} {"ACM Trans. Computer Systems"}

MACRO {tods} {"ACM Trans. Database Systems"}

MACRO {tog} {"ACM Trans. Graphics"}

MACRO {toms} {"ACM Trans. Mathematical Software"}

MACRO {toois} {"ACM Trans. Office Information Systems"}

MACRO {toplas} {"ACM Trans. Programming Languages and Systems"}

MACRO {tcs} {"Theoretical Computer Science"}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
MACRO {jfe} {"Journal of Fluids Engineering"}
MACRO {abb_jfe} {"Journal of Fluids Engineering"}

MACRO {cf} {"Combustion and Flame"}
MACRO {abb_cf} {"Combust. Flame"}

MACRO {tjass} {"TRANSACTIONS OF THE JAPAN SOCIETY FOR AERONAUTICAL AND SPACE SCIENCES"}
MACRO {abb_tjass} {"Trans. Jpn. Soc. Aeronaut. Space Sci."}

MACRO {atj} {"TRANSACTIONS OF THE JAPAN SOCIETY FOR AERONAUTICAL AND SPACE SCIENCES, AEROSPACE TECHNOLOGY JAPAN"}
MACRO {abb_atj} {"Trans. JSASS Aerospace Technology Japan"}

MACRO {aiaaj} {"AIAA Journal"}
MACRO {abb_aiaaj} {"AIAA J."}

MACRO {jgcd} {"Journal of Guidance, Control, and Dynamics"}
MACRO {abb_jgcd} {"J. Guid. Control Dyn."}

MACRO {ja} {"Journal of Aircraft"}
MACRO {abb_ja} {"J. Aircr."}

MACRO {jsr} {"Journal of Spacecraft and Rockets"}
MACRO {abb_jsr} {"J. Spacecr. Rockets"}

MACRO {jpp} {"Journal of Propulsion and Power"}
MACRO {abb_jpp} {"J. Propuls. Power"}

MACRO {jasr} {"Advances in Space Research"}
MACRO {abb_jasr} {"Adv. Space Res."}

MACRO {ast} {"Aerospace Science and Technology"}
MACRO {abb_ast} {"Aerosp. Sci. Technol."}

MACRO {pas} {"Progress in Aerospace Sciences"}
MACRO {abb_pas} {"Prog. Aerosp. Sci."}

MACRO {sn} {"Satellite Navigation"}
MACRO {abb_sn} {"Satell. Navig."}

MACRO {ieee_tvt} {"IEEE Transactions on Vehicular Technology"}
MACRO {abb_ieee_tvt} {"IEEE Trans. Veh. Technol."}

MACRO {sst} {"Space: Science \&amp; Technology"}
MACRO {abb_sst} {"Space: Sci. \& Technol."}

MACRO {ieee_aes} {"IEEE Transactions on Aerospace and Electronic Systems"}
MACRO {abb_ieee_aes} {"IEEE Trans. Aerosp. Electron. Syst."}

MACRO {cja} {"Chinese Journal of Aeronautics"}
MACRO {abb_cja} {"Chin. J. Aeronaut."}

MACRO {aa} {"Acta Astronautica"}
MACRO {abb_aa} {"Acta Astro."}

MACRO {nd} {"Nonlinear Dynamics"}
MACRO {abb_nd} {"Nonlinear Dyn."}

MACRO {efa} {"Engineering Failure Analysis"}
MACRO {abb_efa} {"Eng. Fail. Anal."}

MACRO {ijrnc} {"International Journal of Robust and Nonlinear Control"}
MACRO {abb_ijrnc} {"Int. J. Robust Nonlinear Control"}

MACRO {jitstpo} {"Journal of Intelligent Transportation Systems: Technology, Planning, and Operations"}
MACRO {abb_jitstpo} {"J. Intell. Transp. Syst."}

MACRO {njin} {"Navigation, Journal of the Institute of Navigation"}
MACRO {abb_njin} {"Navig. J. Inst. Navig."}

MACRO {pem} {"Probabilistic Engineering Mechanics"}
MACRO {abb_pem} {"Probabilistic Eng. Mech."}

MACRO {te} {"Transportation Engineering"}
MACRO {abb_te} {"Transp. Eng."}

MACRO {ijio} {"International Journal of Industrial Organization"}
MACRO {abb_ijio} {"Int. J. Ind. Organ."}

MACRO {ijcim} {"International Journal of Computer Integrated Manufacturing"}
MACRO {abb_ijcim} {"Int. J. Comput. Integr. Manuf."}

MACRO {ieee_aesm} {"IEEE Aerospace and Electronic Systems Magazine"}
MACRO {abb_ieee_aesm} {"IEEE Aerosp. Electron. Syst. Mag."}

MACRO {msd} {"Multibody System Dynamics"}
MACRO {abb_msd} {"Multibody Syst. Dyn."}

MACRO {adva} {"Advances in Aerodynamics"}
MACRO {abb_adva} {"Adv. Aerodyn."}

MACRO {ppr} {"Propulsion and Power Research"}
MACRO {abb_ppr} {"Propuls. Power Res."}

MACRO {etfs} {"Experimental Thermal and Fluid Science"}
MACRO {abb_etfs} {"Exp. Therm. Fluid Sci."}

MACRO {ums} {"Unmanned Systems"}
MACRO {abb_ums} {"Unmanned Syst."}

MACRO {jahs} {"Journal of the American Helicopter Society"}
MACRO {abb_jahs} {"J. Am. Helicopter Soc."}

MACRO {ijssd} {"International Journal of Structural Stability and Dynamics"}
MACRO {abb_ijssd} {"Int. J. Struct. Stab. Dyn."}

MACRO {jas} {"Journal of the Astronautical Sciences"}
MACRO {abb_jas} {"J. Astronaut. Sci."}

MACRO {ijnmhff} {"International Journal of Numerical Methods for Heat and Fluid Flow"}
MACRO {abb_ijnmhff} {"Int. J. Numer. Methods Heat Fluid Flow"}

MACRO {jvc} {"Journal of Vibration and Control"}
MACRO {abb_jvc} {"J. Vib. Control"}

MACRO {ieee_jmass} {"IEEE Journal on Miniaturization for Air and Space Systems"}
MACRO {abb_ieee_jmass} {"IEEE J. Miniaturization Air Space Syst."}

MACRO {jsse} {"Journal of Space Safety Engineering"}
MACRO {abb_jsse} {"J. Space Saf. Eng."}

MACRO {jais} {"Journal of Aerospace Information Systems"}
MACRO {abb_jais} {"J. Aerosp. Inf. Syst."}

MACRO {taml} {"Theoretical and Applied Mechanics Letters"}
MACRO {abb_taml} {"Theor. Appl. Mech. Lett."}

MACRO {jgpps} {"Journal of the Global Power and Propulsion Society"}
MACRO {abb_jgpps} {"J. Glob. Power Propuls. Soc."}

MACRO {opte} {"Optimization and Engineering"}
MACRO {abb_opte} {"Optim. Eng."}

MACRO {mbdsm} {"Mechanics Based Design of Structures and Machines"}
MACRO {abb_mbdsm} {"Mech. Based Des. Struct. Mach."}

MACRO {expm} {"Experimental Mechanics"}
MACRO {abb_expm} {"Exp. Mech."}

MACRO {ijer} {"International Journal of Engine Research"}
MACRO {abb_ijer} {"Int. J. Engine Res."}

MACRO {ijdci} {"International Journal of Design Creativity and Innovation"}
MACRO {abb_ijdci} {"Int. J. Des. Creat. Innov."}

MACRO {jegtp} {"Journal of Engineering for Gas Turbines and Power"}
MACRO {abb_jegtp} {"J. Eng. Gas Turbines Power"}

MACRO {mtdm} {"Mechanics of Time-Dependent Materials"}
MACRO {abb_mtdm} {"Mech. Time-Depend. Mater."}

MACRO {gnc} {"Guidance, Navigation and Control"}
MACRO {abb_gnc} {"Guid. Navig. Control"}

MACRO {csj} {"CEAS Space Journal"}
MACRO {abb_csj} {"CEAS Space J."}

MACRO {pimed} {"Proceedings of the Institution of Mechanical Engineers, Part D: Journal of Automobile Engineering"}
MACRO {abb_pimed} {"Proc. Inst. Mech. Eng. D: J. Automob. Eng."}

MACRO {jae} {"Journal of Aerospace Engineering"}
MACRO {abb_jae} {"J. Aerosp. Eng."}

MACRO {jep} {"Journal of Electric Propulsion"}
MACRO {abb_jep} {"J. Electr. Propuls."}

MACRO {aj} {"Aeronautical Journal"}
MACRO {abb_aj} {"Aeronaut. J."}

MACRO {jatm} {"Journal of Aerospace Technology and Management"}
MACRO {abb_jatm} {"J. Aerosp. Technol. Manag."}

MACRO {ijap} {"International Journal of Aerospace Psychology"}
MACRO {abb_ijap} {"Int. J. Aerosp. Psychol."}

MACRO {ija} {"International Journal of Aeroacoustics"}
MACRO {abb_ija} {"Int. J. Aeroacoust."}

MACRO {ijass} {"International Journal of Aeronautical and Space Sciences"}
MACRO {abb_ijass} {"Int. J. Aeronaut. Space Sci."}

MACRO {ctt} {"Control Theory and Technology"}
MACRO {abb_ctt} {"Control Theory Technol."}

MACRO {jat} {"Journal of Air Transportation"}
MACRO {abb_jat} {"J. Air Transp."}

MACRO {caj} {"CEAS Aeronautical Journal"}
MACRO {abb_caj} {"CEAS Aeronaut. J."}

MACRO {aeat} {"Aircraft Engineering and Aerospace Technology"}
MACRO {abb_aeat} {"Aircr. Eng. Aerosp. Technol."}

MACRO {oe} {"Open Engineering"}
MACRO {abb_oe} {"Open Eng."}

MACRO {ijtpp} {"International Journal of Turbomachinery, Propulsion and Power"}
MACRO {abb_ijtpp} {"Int. J. Turbomach. Propuls. Power"}

MACRO {ijmav} {"International Journal of Micro Air Vehicles"}
MACRO {abb_ijmav} {"Int. J. Micro Air Veh."}

MACRO {pimeg} {"Proceedings of the Institution of Mechanical Engineers, Part G: Journal of Aerospace Engineering"}
MACRO {abb_pimeg} {"Proc. Inst. Mech. Eng. G: J. Aerosp. Eng."}

MACRO {ijae} {"International Journal of Aerospace Engineering"}
MACRO {abb_ijae} {"Int. J. Aerosp. Eng."}

MACRO {ijcfd} {"International Journal of Computational Fluid Dynamics"}
MACRO {abb_ijcfd} {"Int. J. Comput. Fluid Dyn."}

MACRO {dsa} {"Drone Systems and Applications"}
MACRO {abb_dsa} {"Drone Syst. Appl."}

MACRO {ijitsr} {"International Journal of Intelligent Transportation Systems Research"}
MACRO {abb_ijitsr} {"Int. J. Intell. Transp. Syst. Res."}

MACRO {csst} {"Chinese Space Science and Technology"}
MACRO {abb_csst} {"Chin. Space Sci. Technol."}

MACRO {lajss} {"Latin American Journal of Solids and Structures"}
MACRO {abb_lajss} {"Lat. Am. J. Solids Struct."}

MACRO {ppte} {"Periodica Polytechnica Transportation Engineering"}
MACRO {abb_ppte} {"Period. Polytech. Transp. Eng."}

MACRO {ptt} {"Promet - Traffic and Transportation"}
MACRO {abb_ptt} {"Promet – Traffic \& Transp."}

MACRO {ijrcs} {"International Journal of Robotics and Control Systems"}
MACRO {abb_ijrcs} {"Int. J. Robot. Control Syst."}

MACRO {ta} {"Thermophysics and Aeromechanics"}
MACRO {abb_ta} {"Thermophys. Aeromech."}

MACRO {as} {"Aerospace Systems"}
MACRO {abb_as} {"Aerosp. Syst."}

MACRO {irae} {"International Review of Aerospace Engineering"}
MACRO {abb_irae} {"Int. Rev. Aerosp. Eng."}

MACRO {sija} {"SAE International Journal of Aerospace"}
MACRO {abb_sija} {"SAE Int. J. Aerosp."}

MACRO {ijtje} {"International Journal of Turbo and Jet Engines"}
MACRO {abb_ijtje} {"Int. J. Turbo Jet Engines"}

MACRO {jarnht} {"Journal of Advanced Research in Numerical Heat Transfer"}
MACRO {abb_jarnht} {"J. Adv. Res. Numer. Heat Transf."}

MACRO {ile} {"Infrared and Laser Engineering"}
MACRO {abb_ile} {"Infrared Laser Eng."}

MACRO {mesa} {"Mathematics in Engineering, Science and Aerospace"}
MACRO {abb_mesa} {"Math. Eng. Sci. Aerosp."}

MACRO {aast} {"Advances in Astronautics Science and Technology"}
MACRO {abb_aast} {"Adv. Astronaut. Sci. Technol."}

MACRO {ijemcp} {"International Journal of Energetic Materials and Chemical Propulsion"}
MACRO {abb_ijemcp} {"Int. J. Energ. Mater. Chem. Propuls."}

MACRO {jdse} {"Journal of Deep Space Exploration"}
MACRO {abb_jdse} {"J. Deep Space Explor."}

MACRO {ijrqse} {"International Journal of Reliability, Quality and Safety Engineering"}
MACRO {abb_ijrqse} {"Int. J. Reliab. Qual. Saf. Eng."}

MACRO {jaaa} {"Journal of Aeronautics, Astronautics and Aviation"}
MACRO {abb_jaaa} {"J. Aeronaut. Astronaut. Aviat."}

MACRO {aase} {"Advances in Aeronautical Science and Engineering"}
MACRO {abb_aase} {"Adv. Aeronaut. Sci. Eng."}

MACRO {sstec} {"Space Science and Technology"}
MACRO {abb_sstec} {"Space Sci. Technol."}

MACRO {jme} {"Journal of Materials Engineering"}
MACRO {abb_jme} {"J. Mater. Eng."}

MACRO {jam} {"Journal of Aeronautical Materials"}
MACRO {abb_jam} {"J. Aeronaut. Mater."}

MACRO {aass} {"Advances in Aircraft and Spacecraft Science"}
MACRO {abb_aass} {"Adv. Aircr. Spacecr. Sci."}

MACRO {jksass} {"Journal of the Korean Society for Aeronautical and Space Sciences"}
MACRO {abb_jksass} {"J. Korean Soc. Aeronaut. Space Sci."}

MACRO {cjss} {"Chinese Journal of Space Science"}
MACRO {abb_cjss} {"Chin. J. Space Sci."}

MACRO {ijaaa} {"International Journal of Aviation, Aeronautics, and Aerospace"}
MACRO {abb_ijaaa} {"Int. J. Aviat. Aeronaut. Aerosp."}

MACRO {ncej} {"Noise Control Engineering Journal"}
MACRO {abb_ncej} {"Noise Control Eng. J."}

MACRO {ijvss}  {"International Journal of Vehicle Structures and Systems"}
MACRO {abb_ijvss}  {"Int. J. Veh. Struct. Syst."}

MACRO {ijacpm} {"SAE International Journal of Advances and Current Practices in Mobility"}
MACRO {abb_ijacpm} {"SAE Int. J. Adv. Curr. Pract. Mobil."}

MACRO {fas} {"Fatigue of Aircraft Structures"}
MACRO {abb_fas} {"Fatigue Aircr. Struct."}

MACRO {ra} {"Russian Aeronautics"}
MACRO {abb_ra} {"Russ. Aeronaut."}

MACRO {jst} {"Journal of Spacecraft Technology"}
MACRO {abb_jst} {"J. Spacecr. Technol."}

MACRO {ijsse} {"International Journal of Space Science and Engineering"}
MACRO {abb_ijsse} {"Int. J. Space Sci. Eng."}

MACRO {ssr} {"Space Science Reviews"}
MACRO {abb_ssr} {"Space Sci. Rev."}

MACRO {jbis} {"Journal of the British Interplanetary Society"}
MACRO {abb_jbis} {"J. Br. Interplanet. Soc."}

MACRO {ea} {"Experimental Astronomy"}
MACRO {abb_ea} {"Exp. Astron."}

MACRO {fae} {"Frontiers in Aerospace Engineering"}
MACRO {abb_fae} {"Front. Aerosp. Eng."}

MACRO {adv_cm} {"Advanced Composite Materials"}
MACRO {abb_adv_cm} {"Adv. Compos. Mater."}
     
MACRO {cst} {"Composites Science and Technology"}
MACRO {abb_cst} {"Compos. Sci. Technol."}

MACRO {cs} {"Composite Structures"}
MACRO {abb_cs} {"Compos. Struct."}

MACRO {jcm} {"Journal of Composite Materials"}
MACRO {abb_jcm} {"J. Compos. Mater."}

MACRO {c_part_a} {"Composites Part A: Applied Science and Manufacturing"}
MACRO {abb_c_part_a} {"Compos. Part A"}

MACRO {c_part_b} {"Composites Part B: Engineering"}
MACRO {abb_c_part_b} {"Compos. Part B"}

MACRO {c_part_c} {"Composites Part C: Open Access"}
MACRO {abb_c_part_c} {"Compos. Part C"}

MACRO {smo} {"Structural and Multidisciplinary Optimization"}
MACRO {abb_smo} {"Struct. Multidiscip. Optim."}

MACRO {jweia} {"Journal of Wind Engineering and Industrial Aerodynamics"}
MACRO {abb_jweia} {"J. Wind Eng. Ind. Aerodyn."}
 
MACRO {jfs} {"Journal of Fluids and Structures"}
MACRO {abb_jfs}  {"J. Fluids Struct."}

MACRO {ijhmt} {"International Journal of Heat and Mass Transfer"}
MACRO {abb_ijhmt} {"Int. J. Heat Mass Transfer"}

MACRO {jtht} {"Journal of Thermophysics and Heat Transfer"}
MACRO {abb_jtht} {"J. Thermophys. Heat Transfer"}

MACRO {ijie} {"International Journal of Impact Engineering"}
MACRO {abb_ijie} {"Int. J. Impact Eng."}

MACRO {jsv} {"Journal of Sound and Vibration"}
MACRO {abb_jsv} {"J. Sound Vib."}

%%%%%%%%%
MACRO {pss} {"Planetary and Space Science"}
MACRO {abb_pss} {"Planet. Space Sci."}

MACRO {jswsc} {"Journal of Space Weather and Space Climate"}
MACRO {abb_jswsc} {"J. Space Weather Space Clim."}

MACRO {am} {"Acta Mechanica"}
MACRO {abb_am} {"Acta Mech."}

MACRO {asdyn} {"Astrodynamics"}
MACRO {abb_asdyn} {"Astrodyn."}

MACRO {cmda} {"Celestial Mechanics and Dynamical Astronomy"}
MACRO {abb_cmda} {"Celest. Mech. Dyn. Astron."}

MACRO {mmas} {"Mathematical Methods in the Applied Sciences"}
MACRO {abb_mmas} {"Math. Methods Appl. Sci."}

MACRO {amhp} {"Aerospace Medicine and Human Performance"}
MACRO {abb_amhp} {"Aerosp. Med. Hum. Perform."}

MACRO {jt} {"ASME Journal of Turbomachinery"}
MACRO {abb_jt} {"J. Turbomach."}

MACRO {jfm} {"Journal of Fluid Mechanics"}
MACRO {abb_jfm}  {"J. Fluid Mech."}

MACRO {ieee_tcst} {"IEEE Transactions on Control Systems Technology"}
MACRO {abb_ieee_tcst} {"IEEE Trans. Control Syst. Technol."}

MACRO {jn} {"Journal of Navigation"}
MACRO {abb_jn} {"J. Navig."}

MACRO {ijscn} {"International Journal of Satellite Communications and Networking"}
MACRO {abb_ijscn} {"Int. J. Satell. Commun. Netw."}

MACRO {jsl} {"Journal of Space Law"}
MACRO {abb_jsl} {"J. Space Law"}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
% automatic change to Journal name abbreviation
%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
STRINGS { jorg jres jabb}
FUNCTION {journal.abbr}
{
  'jorg :=
  jorg 'jres :=

  jorg "Journal of Fluids Engineering" =
    {"J. Fluids Eng." 'jres := }
    'skip$
  if$

  jorg "Combustion and Flame" =
   {"Combust. Flame" 'jres := }
   'skip$
  if$
   
  jorg "TRANSACTIONS OF THE JAPAN SOCIETY FOR AERONAUTICAL AND SPACE SCIENCES" =
    { "Trans. Jpn. Soc. Aeronaut. Space Sci." 'jres := }
    'skip$
  if$

  jorg "TRANSACTIONS OF THE JAPAN SOCIETY FOR AERONAUTICAL AND SPACE SCIENCES, AEROSPACE TECHNOLOGY JAPAN" =
    { "Trans. JSASS Aerospace Technology Japan" 'jres := }
    'skip$
  if$

  jorg "AIAA Journal" =
    { "AIAA J." 'jres := }
    'skip$
  if$

  jorg "Journal of Guidance, Control, and Dynamics" =
    { "J. Guid. Control Dyn." 'jres := }
    'skip$
  if$

  jorg "Journal of Aircraft" =
    { "J. Aircr." 'jres := }
    'skip$
  if$

  jorg "Journal of Spacecraft and Rockets" =
    { "J. Spacecr. Rockets" 'jres := }
    'skip$
  if$

  jorg "Journal of Propulsion and Power" =
    { "J. Propuls. Power" 'jres := }
    'skip$
  if$

  jorg "Advances in Space Research" =
    { "Adv. Space Res." 'jres := }
    'skip$
  if$

  jorg "Aerospace Science and Technology" =
    { "Aerosp. Sci. Technol." 'jres := }
    'skip$
  if$

  jorg "Progress in Aerospace Sciences" =
    { "Prog. Aerosp. Sci." 'jres := }
    'skip$
  if$

  jorg "Satellite Navigation" =
    { "Satell. Navig." 'jres := }
    'skip$
  if$

  jorg "IEEE Transactions on Vehicular Technology" =
    { "IEEE Trans. Veh. Technol." 'jres := }
    'skip$
  if$

  jorg "Space: Science \&amp; Technology" =
    { "Space: Sci. \& Technol." 'jres := }
    'skip$
  if$

  jorg "IEEE Transactions on Aerospace and Electronic Systems" =
    { "IEEE Trans. Aerosp. Electron. Syst." 'jres := }
    'skip$
  if$

  jorg "Chinese Journal of Aeronautics" =
    { "Chin. J. Aeronaut." 'jres := }
    'skip$
  if$

  jorg "Acta Astronautica" =
    { "Acta Astro." 'jres := }
    'skip$
  if$

  jorg "Nonlinear Dynamics" =
    { "Nonlinear Dyn." 'jres := }
    'skip$
  if$

  jorg "Engineering Failure Analysis" =
    { "Eng. Fail. Anal." 'jres := }
    'skip$
  if$

  jorg "International Journal of Robust and Nonlinear Control" =
    { "Int. J. Robust Nonlinear Control" 'jres := }
    'skip$
  if$

  jorg "Journal of Intelligent Transportation Systems: Technology, Planning, and Operations" =
    { "J. Intell. Transp. Syst." 'jres := }
    'skip$
  if$

  jorg "Navigation, Journal of the Institute of Navigation" =
    { "Navig. J. Inst. Navig." 'jres := }
    'skip$
  if$

  jorg "Probabilistic Engineering Mechanics" =
    { "Probabilistic Eng. Mech." 'jres := }
    'skip$
  if$

  jorg "Transportation Engineering" =
    { "Transp. Eng." 'jres := }
    'skip$
  if$

  jorg "International Journal of Industrial Organization" =
    { "Int. J. Ind. Organ." 'jres := }
    'skip$
  if$

  jorg "International Journal of Computer Integrated Manufacturing" =
    { "Int. J. Comput. Integr. Manuf." 'jres := }
    'skip$
  if$

  jorg "IEEE Aerospace and Electronic Systems Magazine" =
    { "IEEE Aerosp. Electron. Syst. Mag." 'jres := }
    'skip$
  if$

  jorg "Multibody System Dynamics" =
    { "Multibody Syst. Dyn." 'jres := }
    'skip$
  if$

  jorg "Advances in Aerodynamics" =
    { "Adv. Aerodyn." 'jres := }
    'skip$
  if$

  jorg "Propulsion and Power Research" =
    { "Propuls. Power Res." 'jres := }
    'skip$
  if$

  jorg "Experimental Thermal and Fluid Science" =
    { "Exp. Therm. Fluid Sci." 'jres := }
    'skip$
  if$

  jorg "Unmanned Systems" =
    { "Unmanned Syst." 'jres := }
    'skip$
  if$

  jorg "Journal of the American Helicopter Society" =
    { "J. Am. Helicopter Soc." 'jres := }
    'skip$
  if$

  jorg "International Journal of Structural Stability and Dynamics" =
    { "Int. J. Struct. Stab. Dyn." 'jres := }
    'skip$
  if$

  jorg "Journal of the Astronautical Sciences" =
    { "J. Astronaut. Sci." 'jres := }
    'skip$
  if$

  jorg "International Journal of Numerical Methods for Heat and Fluid Flow" =
    { "Int. J. Numer. Methods Heat Fluid Flow" 'jres := }
    'skip$
  if$

  jorg "Journal of Vibration and Control" =
    { "J. Vib. Control" 'jres := }
    'skip$
  if$

  jorg "IEEE Journal on Miniaturization for Air and Space Systems" =
    { "IEEE J. Miniaturization Air Space Syst." 'jres := }
    'skip$
  if$

  jorg "Journal of Space Safety Engineering" =
    { "J. Space Saf. Eng." 'jres := }
    'skip$
  if$

  jorg "Journal of Aerospace Information Systems" =
    { "J. Aerosp. Inf. Syst." 'jres := }
    'skip$
  if$

  jorg "Theoretical and Applied Mechanics Letters" =
    { "Theor. Appl. Mech. Lett." 'jres := }
    'skip$
  if$

  jorg "Journal of the Global Power and Propulsion Society" =
    { "J. Glob. Power Propuls. Soc." 'jres := }
    'skip$
  if$

  jorg "Optimization and Engineering" =
    { "Optim. Eng." 'jres := }
    'skip$
  if$

  jorg "Mechanics Based Design of Structures and Machines" =
    { "Mech. Based Des. Struct. Mach." 'jres := }
    'skip$
  if$

  jorg "Experimental Mechanics" =
    { "Exp. Mech." 'jres := }
    'skip$
  if$

  jorg "International Journal of Engine Research" =
    { "Int. J. Engine Res." 'jres := }
    'skip$
  if$

  jorg "International Journal of Design Creativity and Innovation" =
    { "Int. J. Des. Creat. Innov." 'jres := }
    'skip$
  if$

  jorg "Journal of Engineering for Gas Turbines and Power" =
    { "J. Eng. Gas Turbines Power" 'jres := }
    'skip$
  if$

  jorg "Mechanics of Time-Dependent Materials" =
    { "Mech. Time-Depend. Mater." 'jres := }
    'skip$
  if$

  jorg "Guidance, Navigation and Control" =
    { "Guid. Navig. Control" 'jres := }
    'skip$
  if$

  jorg "CEAS Space Journal" =
    { "CEAS Space J." 'jres := }
    'skip$
  if$

  jorg "Proceedings of the Institution of Mechanical Engineers, Part D: Journal of Automobile Engineering" =
    { "Proc. Inst. Mech. Eng. D: J. Automob. Eng." 'jres := }
    'skip$
  if$

  jorg "Journal of Aerospace Engineering" =
    { "J. Aerosp. Eng." 'jres := }
    'skip$
  if$

  jorg "Journal of Electric Propulsion" =
    { "J. Electr. Propuls." 'jres := }
    'skip$
  if$

  jorg "Aeronautical Journal" =
    { "Aeronaut. J." 'jres := }
    'skip$
  if$

  jorg "Journal of Aerospace Technology and Management" =
    { "J. Aerosp. Technol. Manag." 'jres := }
    'skip$
  if$

  jorg "International Journal of Aerospace Psychology" =
    { "Int. J. Aerosp. Psychol." 'jres := }
    'skip$
  if$

  jorg "International Journal of Aeroacoustics" =
    { "Int. J. Aeroacoust." 'jres := }
    'skip$
  if$

  jorg "International Journal of Aeronautical and Space Sciences" =
    { "Int. J. Aeronaut. Space Sci." 'jres := }
    'skip$
  if$

  jorg "Control Theory and Technology" =
    { "Control Theory Technol." 'jres := }
    'skip$
  if$

  jorg "Journal of Air Transportation" =
    { "J. Air Transp." 'jres := }
    'skip$
  if$

  jorg "CEAS Aeronautical Journal" =
    { "CEAS Aeronaut. J." 'jres := }
    'skip$
  if$

  jorg "Aircraft Engineering and Aerospace Technology" =
    { "Aircr. Eng. Aerosp. Technol." 'jres := }
    'skip$
  if$

  jorg "Open Engineering" =
    { "Open Eng." 'jres := }
    'skip$
  if$

  jorg "Journal of Thermophysics and Heat Transfer" =
    { "J. Thermophys. Heat Transf." 'jres := }
    'skip$
  if$

  jorg "International Journal of Turbomachinery, Propulsion and Power" =
    { "Int. J. Turbomach. Propuls. Power" 'jres := }
    'skip$
  if$

  jorg "International Journal of Micro Air Vehicles" =
    { "Int. J. Micro Air Veh." 'jres := }
    'skip$
  if$

  jorg "Proceedings of the Institution of Mechanical Engineers, Part G: Journal of Aerospace Engineering" =
    { "Proc. Inst. Mech. Eng. G: J. Aerosp. Eng." 'jres := }
    'skip$
  if$

  jorg "International Journal of Aerospace Engineering" =
    { "Int. J. Aerosp. Eng." 'jres := }
    'skip$
  if$

  jorg "International Journal of Computational Fluid Dynamics" =
    { "Int. J. Comput. Fluid Dyn." 'jres := }
    'skip$
  if$

  jorg "Drone Systems and Applications" =
    { "Drone Syst. Appl." 'jres := }
    'skip$
  if$

  jorg "International Journal of Intelligent Transportation Systems Research" =
    { "Int. J. Intell. Transp. Syst. Res." 'jres := }
    'skip$
  if$

  jorg "Chinese Space Science and Technology" =
    { "Chin. Space Sci. Technol." 'jres := }
    'skip$
  if$

  jorg "Latin American Journal of Solids and Structures" =
    { "Lat. Am. J. Solids Struct." 'jres := }
    'skip$
  if$

  jorg "Periodica Polytechnica Transportation Engineering" =
    { "Period. Polytech. Transp. Eng." 'jres := }
    'skip$
  if$

  jorg "Promet - Traffic and Transportation" =
    { "Promet – Traffic \& Transp." 'jres := }
    'skip$
  if$

  jorg "International Journal of Robotics and Control Systems" =
    { "Int. J. Robot. Control Syst." 'jres := }
    'skip$
  if$

  jorg "Thermophysics and Aeromechanics" =
    { "Thermophys. Aeromech." 'jres := }
    'skip$
  if$

  jorg "Aerospace Systems" =
    { "Aerosp. Syst." 'jres := }
    'skip$
  if$

  jorg "International Review of Aerospace Engineering" =
    { "Int. Rev. Aerosp. Eng." 'jres := }
    'skip$
  if$

  jorg "SAE International Journal of Aerospace" =
    { "SAE Int. J. Aerosp." 'jres := }
    'skip$
  if$

  jorg "International Journal of Turbo and Jet Engines" =
    { "Int. J. Turbo Jet Engines" 'jres := }
    'skip$
  if$

  jorg "Journal of Advanced Research in Numerical Heat Transfer" =
    { "J. Adv. Res. Numer. Heat Transf." 'jres := }
    'skip$
  if$

  jorg "Infrared and Laser Engineering" =
    { "Infrared Laser Eng." 'jres := }
    'skip$
  if$

  jorg "Mathematics in Engineering, Science and Aerospace" =
    { "Math. Eng. Sci. Aerosp." 'jres := }
    'skip$
  if$

  jorg "Advances in Astronautics Science and Technology" =
    { "Adv. Astronaut. Sci. Technol." 'jres := }
    'skip$
  if$

  jorg "International Journal of Energetic Materials and Chemical Propulsion" =
    { "Int. J. Energ. Mater. Chem. Propuls." 'jres := }
    'skip$
  if$

  jorg "Journal of Deep Space Exploration" =
    { "J. Deep Space Explor." 'jres := }
    'skip$
  if$

  jorg "International Journal of Reliability, Quality and Safety Engineering" =
    { "Int. J. Reliab. Qual. Saf. Eng." 'jres := }
    'skip$
  if$

  jorg "Journal of Aeronautics, Astronautics and Aviation" =
    { "J. Aeronaut. Astronaut. Aviat." 'jres := }
    'skip$
  if$

  jorg "Advances in Aeronautical Science and Engineering" =
    { "Adv. Aeronaut. Sci. Eng." 'jres := }
    'skip$
  if$

  jorg "Space Science and Technology" =
    { "Space Sci. Technol." 'jres := }
    'skip$
  if$

  jorg "Journal of Materials Engineering" =
    { "J. Mater. Eng." 'jres := }
    'skip$
  if$

  jorg "Journal of Aeronautical Materials" =
    { "J. Aeronaut. Mater." 'jres := }
    'skip$
  if$

  jorg "Advances in Aircraft and Spacecraft Science" =
    { "Adv. Aircr. Spacecr. Sci." 'jres := }
    'skip$
  if$

  jorg "Journal of the Korean Society for Aeronautical and Space Sciences" =
    { "J. Korean Soc. Aeronaut. Space Sci." 'jres := }
    'skip$
  if$

  jorg "Chinese Journal of Space Science" =
    { "Chin. J. Space Sci." 'jres := }
    'skip$
  if$

  jorg "International Journal of Aviation, Aeronautics, and Aerospace" =
    { "Int. J. Aviat. Aeronaut. Aerosp." 'jres := }
    'skip$
  if$

  jorg "Noise Control Engineering Journal" =
    { "Noise Control Eng. J." 'jres := }
    'skip$
  if$

  jorg "International Journal of Vehicle Structures and Systems" =
    { "Int. J. Veh. Struct. Syst." 'jres := }
    'skip$
  if$

  jorg "SAE International Journal of Advances and Current Practices in Mobility" =
    { "SAE Int. J. Adv. Curr. Pract. Mobil." 'jres := }
    'skip$
  if$

  jorg "Fatigue of Aircraft Structures" =
    { "Fatigue Aircr. Struct." 'jres := }
    'skip$
  if$

  jorg "Russian Aeronautics" =
    { "Russ. Aeronaut." 'jres := }
    'skip$
  if$

  jorg "Journal of Spacecraft Technology" =
    { "J. Spacecr. Technol." 'jres := }
    'skip$
  if$

  jorg "International Journal of Space Science and Engineering" =
    { "Int. J. Space Sci. Eng." 'jres := }
    'skip$
  if$
  
  jorg "Space Science Reviews" =
     { "Space Sci. Rev." 'jres := }
     'skip$
  if$

  jorg "Experimental Astronomy" = 
     {"Exp. Astron."  'jres := }
     'skip$
  if$

  jorg "Frontiers in Aerospace Engineering" =
     {"Front. Aerosp. Eng."  'jres := }
     'skip$
  if$

  jorg "Journal of the British Interplanetary Society" =
     {"J. Br. Interplanet. Soc." 'jres := }
     'skip$
  if$

  jorg "Advanced Composite Materials" =
    { "Adv. Compos. Mater." 'jres := }
    'skip$
  if$
  
  jorg "Composites Science and Technology" =
    { "Compos. Sci. Technol." 'jres := }
    'skip$
  if$
  
  jorg "Composite Structures" =
    { "Compos. Struct." 'jres := }
    'skip$
  if$
  
  jorg "Journal of Composite Materials" =
    { "J. Compos. Mater." 'jres := }
    'skip$
  if$
  
  jorg "Composites Part A: Applied Science and Manufacturing" =
    { "Compos. Part A" 'jres := }
    'skip$
  if$
  
  jorg "Composites Part B: Engineering" = 
    { "Compos. Part B" 'jres := }
    'skip$
  if$
  
  jorg "Composites Part C: Open Access" = 
    { "Compos. Part C" 'jres := }
    'skip$
  if$

  jorg "Structural and Multidisciplinary Optimization" = 
    { "Struct. Multidiscip. Optim." 'jres := }
    'skip$
  if$

  jorg "Journal of Wind Engineering and Industrial Aerodynamics" =
    {"J. Wind Eng. Ind. Aerodyn." 'jres :=}
    'skip$
  if$
  
  jorg "Journal of Fluids and Structures" =
    {"J. Fluids Struct." 'jres :=}
    'skip$
  if$

  jorg "International Journal of Heat and Mass Transfer" =
    {"Int. J. Heat Mass Transfer" 'jres :=}
    'skip$
  if$

  jorg "International Journal of Impact Engineering" =
    {"Int. J. Impact Eng."  'jres :=}
    'skip$
  if$

  jorg "Journal of Thermophysics and Heat Transfer"  =
    {"J. Thermophys. Heat Transfer"  'jres :=}
    'skip$
  if$

  jorg "Journal of Sound and Vibration"  =
    {"J. Sound Vib."  'jres :=}
    'skip$
  if$

  jorg "Planetary and Space Science" = 
    {"Planet. Space Sci." 'jres := }
    'skip$
  if$
    
  jorg "Journal of Space Weather and Space Climate" = 
    {"J. Space Weather Space Clim." 'jres := }
    'skip$
  if$

  jorg "Acta Mechanica" = 
    {"Acta Mech." 'jres := }
    'skip$
  if$

  jorg "Astrodynamics" = 
    {"Astrodyn." 'jres := }
    'skip$
  if$

  jorg "Celestial Mechanics and Dynamical Astronomy" = 
    {"Celest. Mech. Dyn. Astron." 'jres := }
    'skip$
  if$

  jorg "Mathematical Methods in the Applied Sciences" = 
    {"Math. Methods Appl. Sci." 'jres := }
    'skip$
  if$

  jorg "Aerospace Medicine and Human Performance" = 
    {"Aerosp. Med. Hum. Perform." 'jres := }
    'skip$
  if$

  jorg "ASME Journal of Turbomachinery" = 
    {"J. Turbomach." 'jres := }
    'skip$
  if$

  jorg "Journal of Fluid Mechanics" = 
    {"J. Fluid Mech." 'jres := }
    'skip$
  if$

  jorg "IEEE Transactions on Control Systems Technology" = 
    {"IEEE Trans. Control Syst. Technol." 'jres := }
    'skip$
  if$

  jorg "Journal of Navigation" = 
    {"J. Navig." 'jres := }
    'skip$
  if$

  jorg "International Journal of Satellite Communications and Networking"  = 
    {"Int. J. Satell. Commun. Netw." 'jres := }
    'skip$
  if$

  jorg "Journal of Space Law" = 
    {"J. Space Law" 'jres := }
    'skip$
  if$

  jres
}

%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
FUNCTION {format.journal}
{ journal empty$
    { "\textcolor{red}{journal missing}" }
    { journal journal.abbr 'jabb :=
      "{\em " jabb * "}" * 
    }
  if$
}

FUNCTION {format.article.pages}
{ pages empty$
    { "\textcolor{red}{pages missing}" }
    { pages multi.page.check
	{ "pp.~" pages n.dashify * }
	{ "" pages * }
	%{ "p.~" pages * }
      if$
    }
  if$
}

FUNCTION{format.article.year}
{
  year empty$
  { "\textcolor{red}{year missing}" }
  { year parenthesis }
  if$
}

FUNCTION{format.year.note}
{
   year empty$
    { "\textcolor{red}{year missing}" 
        note empty$
        'skip$
         { " " * note *}
        if$
    }
    { year 
       note empty$
       'skip$
       { " " * note *}
       if$
    }
    if$
}

FUNCTION {article}
{ output.bibitem
  format.authors "author" output.check
  col.sep
  format.title "title" output.check
  format.journal "journal" output.check
  format.volume "volume" output.check
  get.issue empty$
  'skip$
  { get.issue output}
  if$
  blank.sep
  year empty$
    { "\textcolor{red}{year missing}" }
    { year parenthesis "year" output.check}
  if$
  format.article.pages "pages" output.check
  note empty$
   { "" output}
   { " " * note * }
  if$
  fin.entry
}

FUNCTION {book}
{ output.bibitem
  format.authors "author" output.check
  col.sep
  format.btitle emphasize "booktitle" output.check
  format.edition output
  crossref missing$
    { format.bvolume output
      format.number.series output
      format.publisher "publisher" output.check
      format.address "address" output.check
      format.date "year" output.check
      format.pages output
      note empty$
      'skip$
        { " " * note * }
      if$
    }
    { new.block
      format.book.crossref output.nonnull
    }
  if$ 
  fin.entry
}

FUNCTION {booklet}
{ output.bibitem
  format.authors output
  title empty$
    { "empty title in " cite$ * warning$
      howpublished new.sentence.checka
    }
    { howpublished empty$ not
      address empty$ month empty$ year empty$ and and
      or
	{ format.title.p output.nonnull }
	{ format.title output.nonnull }
      if$
      blank.sep
    }
  if$
  howpublished output
  format.date output
  address output
  new.block
  note output
  fin.entry
}

FUNCTION {inbook}
{ output.bibitem
  author empty$
    { format.editors "author and editor" output.check }
    { format.authors output.nonnull
      crossref missing$
	{ "author and editor" editor either.or.check }
	'skip$
      if$
    }
  if$
  format.btitle emphasize "booktitle" output.check
  crossref missing$
    { format.bvolume output
      format.chapter.pages "chapter and pages" output.check
      new.block
      format.number.series output
      format.pub.addr "publisher" output.check
    }
    { format.chapter.pages "chapter and pages" output.check
      new.block
      format.book.crossref output.nonnull
    }
  if$
  format.edition output
  format.date "year" output.check
  new.block
  note output
  fin.entry
}

FUNCTION {incollection}
{ output.bibitem
  format.authors "author" output.check
  col.sep
  format.title "title" output.check
  crossref missing$
    { format.editors "editor" output.check
      format.btitle emphasize "booktitle" output.check
      format.bvolume output
      format.number.series output
      format.publisher "publisher" output.check
      format.address "address" output.check
      format.edition output
      format.date "year" output.check
      format.chapter.pages output    
    }
    { format.incoll.inproc.crossref output.nonnull
      format.chapter.pages output
    }
  if$
  fin.entry
}

FUNCTION {inproceedings}
{ output.bibitem
  format.authors "author" output.check
  col.sep
  format.title "title" output.check
  crossref missing$
  {
      format.btitle "booktilte" output.check
      format.address "address" output.check
      format.number "number" output.check
      format.year.note "year" output.check
    }
    { format.article.crossref output.nonnull }
  if$
  fin.entry
}

FUNCTION {conference} { inproceedings }

FUNCTION {manual}
{ output.bibitem
  author empty$
    { organization empty$
	'skip$
	{ organization output.nonnull
	  address output
	}
      if$
    }
    { format.authors output.nonnull }
  if$
  col.sep
  format.btitle "booktitle" output.check
  author empty$
    { organization empty$
	{ address new.block.checka
	  address output
	}
	'skip$
      if$
    }
    { organization address new.block.checkb
      organization output
      address output
    }
  if$
  format.edition output
  format.date output
  new.block
  note output
  fin.entry
}

FUNCTION {format.institution}
{ institution empty$
    { "\textcolor{red}{institution missing}" }
    { institution }
  if$
}

FUNCTION {misc}
{ output.bibitem
   author empty$
    'skip$
    { format.authors "author" output.check 
     col.sep 
    }
  if$
  title empty$
    'skip$
    { format.title "title" output.check}
  if$
  format.institution "institution" output.check
  year empty$
  { "" }
  {format.date "year" output.check ""}
  if$
  url empty$
  'skip$
  { format.url * " "
   note empty$
   { "" }
   {  * note * output}
   if$
  }
  if$
  fin.entry
  %empty.misc.check
}

FUNCTION {phdthesis}
{ output.bibitem
  format.authors "author" output.check
  col.sep
  format.title "title" output.check
  "Ph.D Thesis" format.thesis.type output.nonnull
  school "school" output.check
  format.year.note "year" output.check
  fin.entry
}

FUNCTION {mastersthesis}
{ output.bibitem
  format.authors "author" output.check
  col.sep
  format.title "title" output.check
  "Master's Thesis" format.thesis.type output.nonnull
  school "school" output.check
  format.year.note "year" output.check
  fin.entry
}

FUNCTION {aiaapapers}
{ output.bibitem
  format.authors "author" output.check
  col.sep
  format.title "title" output.check
  format.number "number" output.check
  format.date "year" output.check
  new.block
  note output
  fin.entry
}

FUNCTION {proceedings}
{ output.bibitem
  editor empty$
    { organization output }
    { format.editors output.nonnull }
  if$
  format.btitle "booktitle" output.check
  format.bvolume output
  format.number.series output
  format.paddress output
  editor empty$
    'skip$
    { organization output }
  if$
  publisher output
  format.date "year" output.check
  new.block
  note output
  fin.entry
}

FUNCTION{format.booktitle}
{ booktitle empty$
 { "\textcolor{red}{booktitle missing}" }
 { booktitle }
 if$
}

FUNCTION {techreport}
{ output.bibitem
  format.authors "author" output.check
  col.sep
  format.title "title" output.check
  format.booktitle "booktile" output.check
  format.date "year" output.check
  pages empty$
    'skip$
    { format.pages output }
  if$
  note empty$
     'skip$
    { " " * note * }
  if$
  fin.entry
}

FUNCTION {unpublished}
{ output.bibitem
  format.authors "author" output.check
  format.title.p "title" output.check
  blank.sep
  note "note" output.check
  format.date output
  fin.entry
}

FUNCTION {default.type} { misc }

MACRO {jan} {"Jan."}

MACRO {feb} {"Feb."}

MACRO {mar} {"Mar."}

MACRO {apr} {"Apr."}

MACRO {may} {"May"}

MACRO {jun} {"June"}

MACRO {jul} {"July"}

MACRO {aug} {"Aug."}

MACRO {sep} {"Sept."}

MACRO {oct} {"Oct."}

MACRO {nov} {"Nov."}

MACRO {dec} {"Dec."}


READ 

STRINGS { longest.label }

INTEGERS { number.label longest.label.width }

FUNCTION {initialize.longest.label}
{ "" 'longest.label :=
  #1 'number.label :=
  #0 'longest.label.width :=
}

FUNCTION {longest.label.pass}
{ number.label int.to.str$ 'label :=
  number.label #1 + 'number.label :=
  label width$ longest.label.width >
    { label 'longest.label :=
      label width$ 'longest.label.width :=
    }
    'skip$
  if$
}

EXECUTE {initialize.longest.label}

ITERATE {longest.label.pass}

FUNCTION {begin.bib}
{ preamble$ empty$
    'skip$
    { preamble$ write$ newline$ }
  if$
  "\begin{thebibliography}{"  longest.label  * "}" * write$ newline$
}

EXECUTE {begin.bib}

EXECUTE {init.state.consts}

ITERATE {call.type$}

FUNCTION {end.bib}
{ newline$
  "\end{thebibliography}" write$ newline$
}

EXECUTE {end.bib}
