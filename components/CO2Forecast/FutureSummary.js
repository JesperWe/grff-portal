import React from "react"
import useText from "lib/useText"
import { useSelector } from "react-redux"
import { useConversionHooks } from "../viz/conversionHooks"
import { addToTotal } from "./calculate"
import settings from "settings"
import SourceBars from "../viz/SourceBars"
import { Col, Row } from "antd"
import CsvDownloader from "react-csv-downloader"
import { DownloadOutlined } from "@ant-design/icons"

const DEBUG = false

const _csvFormatter = s => {
	if( !s?.total?.oil?.scope1 ) {
		return []
	}
	return [ 'oil', 'gas' ].map( fuel => ( {
		scenario: s.name,
		fuel,
		scope1_low: s.total[ fuel ].scope1[ 0 ],
		scope1_mid: s.total[ fuel ].scope1[ 1 ],
		scope1_high: s.total[ fuel ].scope1[ 2 ],
		scope3_low: s.total[ fuel ].scope3[ 0 ],
		scope3_mid: s.total[ fuel ].scope3[ 1 ],
		scope3_high: s.total[ fuel ].scope3[ 2 ]
	} ) )
}

function FutureSummary( { dataset, limits, projectionSources } ) {
	const { getText } = useText()
	const country = useSelector( redux => redux.country )
	const { co2FromVolume } = useConversionHooks()
	const stableProduction = useSelector( redux => redux.stableProduction )
	const allSources = useSelector( redux => redux.allSources )
	const projectionSourceId = useSelector( redux => redux.projectionSourceId )

	if( !( dataset?.length > 0 ) ) return null
	if( !stableProduction.oil || !stableProduction.gas ) return null

	DEBUG && console.info( { projectionSourceId, allSources, limits, stableProduction } )

	const stable = {
		oil: co2FromVolume( stableProduction.oil ),
		gas: co2FromVolume( stableProduction.gas )
	}

	const projectionSource = allSources.find( s => s.sourceId === projectionSourceId )
	if( !projectionSource ) return null
	let sourceName = projectionSource?.name
	if( sourceName.startsWith( 'name_' ) ) sourceName = getText( sourceName )

	const year = dataset.reduce( ( yrs, datapoint ) => {
		yrs.first = Math.min( datapoint.year, yrs.first ?? 9999 )
		yrs.last = Math.max( datapoint.year, yrs.last ?? 0 )
		return yrs
	}, {} )
	year.first = Math.max( new Date().getFullYear(), year.first )
	const years = 1 + year.last - year.first

	const distinctSourceIds = {}
	const sources = ( projectionSources ?? [] )
		.filter( s => {
			if( s.sourceId === settings.stableProductionSourceId ) return false
			if( distinctSourceIds[ s.sourceId ] ) return false
			distinctSourceIds[ s.sourceId ] = true
			return true
		} )
		.map( source => {
			const sourceTotal = {
				oil: { scope1: [ 0, 0, 0 ], scope3: [ 0, 0, 0 ] },
				gas: { scope1: [ 0, 0, 0 ], scope3: [ 0, 0, 0 ] }
			}
			DEBUG && console.info( 'Source data', source.sourceId, dataset )
			dataset
				.filter( d => d.sourceId === source.sourceId )
				.forEach( d => {
					if( d.year < year.first ) return
					addToTotal( sourceTotal[ d.fossilFuelType ], d.co2 )
				} )

			return { ...source, total: sourceTotal }
		} )

	const stableSource = {
		name: 'name_projection_stable',
		sourceId: 100,
		total: {
			oil: { scope1: stable.oil.scope1.map( e => years * e ), scope3: stable.oil.scope3.map( e => years * e ) },
			gas: { scope1: stable.gas.scope1.map( e => years * e ), scope3: stable.gas.scope3.map( e => years * e ) }
		}
	}

	const csvData = [ ..._csvFormatter( stableSource ) ]

	sources.forEach( s => {
		const srcCsv = _csvFormatter( s )
		srcCsv.forEach( row => csvData.push( row ) )
	} )

	DEBUG && console.info( { years, year, stable, stableSource, csvData, dataset, sources } )

	return (
		<div className="table-wrap">

			<div className="top">
				<Row gutter={ 12 } style={ { display: 'inline-flex' } }>
					<Col>
						{ getText( 'future_emissions' ) }<br/>
						{ getText( 'megaton' ) } CO²e
					</Col>
					<Col>
						<CsvDownloader
							datas={ csvData }
							filename={ country + '_emissions_forecast.csv' }
						>
							<DownloadOutlined/>
						</CsvDownloader>
					</Col>
				</Row>
			</div>

			<div style={ { flexGrow: 1, minHeight: 400 } }>
				<SourceBars
					sources={ [ ...sources, stableSource ] }
				/>
			</div>

			<style jsx>{ `
              .table-wrap {
                border: 1px solid #dddddd;
                border-radius: 8px;
                position: relative;
                display: flex;
                flex-direction: column;
                height: 100%;
              }

              .table-wrap :global(svg) {
                display: block;
              }

              .top {
                width: 100%;
                background-color: #eeeeee;
                padding: 3px 12px;
                font-weight: bold;
                text-align: center;
              }

              .table-wrap :global(svg) {
                margin: 0 auto;
              }
			` }
			</style>
		</div>
	)
}

export default FutureSummary
